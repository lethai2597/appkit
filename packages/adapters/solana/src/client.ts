import { WcHelpersUtil, type AppKit, type AppKitOptions } from '@reown/appkit'
import {
  ConstantsUtil as CommonConstantsUtil,
  type CaipNetwork,
  UnitsUtil
} from '@reown/appkit-common'
import {
  AlertController,
  ChainController,
  CoreHelperUtil,
  EventsController,
  type Provider as CoreProvider
} from '@reown/appkit-core'
import { ErrorUtil } from '@reown/appkit-utils'
import { AdapterBlueprint } from '@reown/appkit/adapters'
import type { BaseWalletAdapter } from '@solana/wallet-adapter-base'
import type { Commitment, ConnectionConfig } from '@solana/web3.js'
import { Connection, PublicKey } from '@solana/web3.js'
import UniversalProvider from '@walletconnect/universal-provider'
import bs58 from 'bs58'
import { AuthProvider } from './providers/AuthProvider.js'
import {
  CoinbaseWalletProvider,
  type SolanaCoinbaseWallet
} from './providers/CoinbaseWalletProvider.js'
import { WalletConnectProvider } from './providers/WalletConnectProvider.js'
import { createSendTransaction } from './utils/createSendTransaction.js'
import { handleMobileWalletRedirection } from './utils/handleMobileWalletRedirection.js'
import { SolStoreUtil } from './utils/SolanaStoreUtil.js'
import { watchStandard } from './utils/watchStandard.js'
import type { Provider as SolanaProvider } from '@reown/appkit-utils/solana'
import { W3mFrameProvider } from '@reown/appkit-wallet'

export interface AdapterOptions {
  connectionSettings?: Commitment | ConnectionConfig
  wallets?: BaseWalletAdapter[]
}

export class SolanaAdapter extends AdapterBlueprint<SolanaProvider> {
  private connectionSettings: Commitment | ConnectionConfig
  public adapterType = 'solana'
  public wallets?: BaseWalletAdapter[]

  constructor(options: AdapterOptions = {}) {
    super({})
    this.namespace = CommonConstantsUtil.CHAIN.SOLANA
    this.connectionSettings = options.connectionSettings || 'confirmed'
    this.wallets = options.wallets

    EventsController.subscribe(state => {
      if (state.data.event === 'SELECT_WALLET') {
        const isMobile = CoreHelperUtil.isMobile()
        const isClient = CoreHelperUtil.isClient()

        if (isMobile && isClient) {
          handleMobileWalletRedirection(state.data.properties)
        }
      }
    })
  }

  public override setAuthProvider(w3mFrameProvider: W3mFrameProvider) {
    this.addConnector(
      new AuthProvider({
        w3mFrameProvider,
        getActiveChain: () => ChainController.state.activeCaipNetwork,
        chains: this.caipNetworks as CaipNetwork[]
      })
    )
  }

  public syncConnectors(options: AppKitOptions, appKit: AppKit) {
    if (!options.projectId) {
      AlertController.open(ErrorUtil.ALERT_ERRORS.PROJECT_ID_NOT_CONFIGURED, 'error')
    }

    // eslint-disable-next-line arrow-body-style
    const getActiveChain = () => appKit.getCaipNetwork(this.namespace)

    // Add Coinbase Wallet if available
    if (CoreHelperUtil.isClient() && 'coinbaseSolana' in window) {
      this.addConnector(
        new CoinbaseWalletProvider({
          provider: window.coinbaseSolana as SolanaCoinbaseWallet,
          chains: this.caipNetworks as CaipNetwork[],
          getActiveChain
        })
      )
    }

    // Watch for standard wallet adapters
    watchStandard(this.caipNetworks as CaipNetwork[], getActiveChain, this.addConnector.bind(this))
  }

  // -- Transaction methods ---------------------------------------------------
  /**
   *
   * These methods are supported only on `wagmi` and `ethers` since the Solana SDK does not support them in the same way.
   * These function definition is to have a type parity between the clients. Currently not in use.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  public async getEnsAddress(
    params: AdapterBlueprint.GetEnsAddressParams
  ): Promise<AdapterBlueprint.GetEnsAddressResult> {
    return { address: params.name }
  }

  public async writeContract(): Promise<AdapterBlueprint.WriteContractResult> {
    return Promise.resolve({
      hash: ''
    })
  }

  public async getCapabilities(): Promise<unknown> {
    return Promise.resolve({})
  }

  public async grantPermissions(): Promise<unknown> {
    return Promise.resolve({})
  }

  public async revokePermissions(): Promise<`0x${string}`> {
    return Promise.resolve('0x')
  }

  public async getAccounts(
    params: AdapterBlueprint.GetAccountsParams
  ): Promise<AdapterBlueprint.GetAccountsResult> {
    const connector = this.connectors.find(c => c.id === params.id)
    if (!connector) {
      return { accounts: [] }
    }

    return { accounts: await connector.getAccounts() }
  }

  public async signMessage(
    params: AdapterBlueprint.SignMessageParams
  ): Promise<AdapterBlueprint.SignMessageResult> {
    const provider = params.provider as SolanaProvider
    if (!provider) {
      throw new Error('connectionControllerClient:signMessage - provider is undefined')
    }

    const signature = await provider.signMessage(new TextEncoder().encode(params.message))

    return {
      signature: bs58.encode(signature)
    }
  }

  public async estimateGas(
    params: AdapterBlueprint.EstimateGasTransactionArgs
  ): Promise<AdapterBlueprint.EstimateGasTransactionResult> {
    const connection = SolStoreUtil.state.connection

    if (!connection || !params.provider) {
      throw new Error('Connection is not set')
    }

    const transaction = await createSendTransaction({
      provider: params.provider as SolanaProvider,
      connection,
      to: '11111111111111111111111111111111',
      value: 1
    })

    const fee = await transaction.getEstimatedFee(connection)

    return {
      gas: BigInt(fee || 0)
    }
  }

  public async sendTransaction(
    params: AdapterBlueprint.SendTransactionParams
  ): Promise<AdapterBlueprint.SendTransactionResult> {
    const connection = SolStoreUtil.state.connection

    if (!connection || !params.address || !params.provider) {
      throw new Error('Connection is not set')
    }

    const provider = params.provider as SolanaProvider

    const transaction = await createSendTransaction({
      provider,
      connection,
      to: params.to,
      value: params.value as number
    })

    const result = await provider.sendTransaction(transaction, connection)

    await new Promise<void>(resolve => {
      const interval = setInterval(async () => {
        const status = await connection.getSignatureStatus(result)

        if (status?.value) {
          clearInterval(interval)
          resolve()
        }
      }, 1000)
    })

    return {
      hash: result
    }
  }

  public parseUnits(): bigint {
    return 0n
  }

  public formatUnits(): string {
    return ''
  }

  public async connect(
    params: AdapterBlueprint.ConnectParams
  ): Promise<AdapterBlueprint.ConnectResult> {
    const connector = this.connectors.find(c => c.id === params.id)

    if (!connector) {
      throw new Error('Provider not found')
    }

    const rpcUrl =
      params.rpcUrl ||
      this.caipNetworks?.find(n => n.id === params.chainId)?.rpcUrls.default.http[0]

    if (!rpcUrl) {
      throw new Error(`RPC URL not found for chainId: ${params.chainId}`)
    }

    const address = await connector.connect({
      chainId: params.chainId as string
    })
    this.listenProviderEvents(connector)

    SolStoreUtil.setConnection(new Connection(rpcUrl, this.connectionSettings))

    return {
      id: connector.id,
      address,
      chainId: params.chainId as string,
      provider: connector as CoreProvider,
      type: connector.type
    }
  }

  public async getBalance(
    params: AdapterBlueprint.GetBalanceParams
  ): Promise<AdapterBlueprint.GetBalanceResult> {
    if (!params.caipNetwork) {
      throw new Error('caipNetwork is required')
    }

    const connection = new Connection(
      params.caipNetwork.rpcUrls?.default?.http?.[0] as string,
      this.connectionSettings
    )

    const balance = await connection.getBalance(new PublicKey(params.address))
    console.log('>> Balance', balance)
    const formattedBalance = UnitsUtil.toDecimal(balance.toString(), params.caipNetwork)
    console.log('>> Formatted balance', formattedBalance)

    return {
      balance: formattedBalance,
      symbol: params.caipNetwork?.nativeCurrency.symbol
    }
  }

  public override async switchNetwork(params: AdapterBlueprint.SwitchNetworkParams): Promise<void> {
    await super.switchNetwork(params)

    const { caipNetwork } = params

    if (caipNetwork?.rpcUrls?.default?.http?.[0]) {
      SolStoreUtil.setConnection(
        new Connection(caipNetwork.rpcUrls.default.http[0], this.connectionSettings)
      )
    }
  }

  private listenProviderEvents(provider: SolanaProvider) {
    const disconnectHandler = () => {
      this.removeProviderListeners(provider)
      this.emit('disconnect')
    }

    const accountsChangedHandler = (publicKey: PublicKey) => {
      const address = publicKey.toBase58()
      if (address) {
        this.emit('accountChanged', { address })
      }
    }

    provider.on('disconnect', disconnectHandler)
    provider.on('accountsChanged', accountsChangedHandler)
    provider.on('connect', accountsChangedHandler)
    provider.on('pendingTransaction', () => {
      this.emit('pendingTransactions')
    })

    this.providerHandlers = {
      disconnect: disconnectHandler,
      accountsChanged: accountsChangedHandler
    }
  }

  private providerHandlers: {
    disconnect: () => void
    accountsChanged: (publicKey: PublicKey) => void
  } | null = null

  private removeProviderListeners(provider: SolanaProvider) {
    if (this.providerHandlers) {
      provider.removeListener('disconnect', this.providerHandlers.disconnect)
      provider.removeListener('accountsChanged', this.providerHandlers.accountsChanged)
      provider.removeListener('connect', this.providerHandlers.accountsChanged)
      this.providerHandlers = null
    }
  }

  public async connectWalletConnect(onUri: (uri: string) => void): Promise<void> {
    const connector = this.connectors.find(c => c.type === 'WALLET_CONNECT')
    const provider = connector?.provider as UniversalProvider

    if (!this.caipNetworks || !provider) {
      throw new Error(
        'UniversalAdapter:connectWalletConnect - caipNetworks or provider is undefined'
      )
    }

    provider.on('display_uri', onUri)

    const namespaces = WcHelpersUtil.createNamespaces(this.caipNetworks)
    await provider.connect({ optionalNamespaces: namespaces })
    const rpcUrl = this.caipNetworks[0]?.rpcUrls?.default?.http?.[0] as string
    const connection = new Connection(rpcUrl, 'confirmed')

    SolStoreUtil.setConnection(connection)
  }

  public async disconnect(params: AdapterBlueprint.DisconnectParams): Promise<void> {
    if (!params.provider || !params.providerType) {
      throw new Error('Provider or providerType not provided')
    }

    await params.provider.disconnect()
  }

  public async getProfile(): Promise<AdapterBlueprint.GetProfileResult> {
    return Promise.resolve({
      profileName: undefined,
      profileImage: undefined
    })
  }

  public async syncConnection(
    params: AdapterBlueprint.SyncConnectionParams
  ): Promise<AdapterBlueprint.ConnectResult> {
    return this.connect({
      ...params,
      type: ''
    })
  }

  public getWalletConnectProvider(
    params: AdapterBlueprint.GetWalletConnectProviderParams
  ): AdapterBlueprint.GetWalletConnectProviderResult {
    const walletConnectProvider = new WalletConnectProvider({
      provider: params.provider as UniversalProvider,
      chains: params.caipNetworks,
      getActiveChain: () => ChainController.state.activeCaipNetwork
    })

    return walletConnectProvider as unknown as UniversalProvider
  }
}
