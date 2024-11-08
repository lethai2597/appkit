/* eslint-disable max-depth */
import {
  AccountController,
  ChainController,
  ConnectionController,
  CoreHelperUtil,
  StorageUtil,
  type ConnectionControllerClient,
  type Connector,
  type NetworkControllerClient,
  AlertController,
  BlockchainApiController
} from '@reown/appkit-core'
import { ConstantsUtil, ErrorUtil, LoggerUtil, PresetsUtil } from '@reown/appkit-utils'
import UniversalProvider from '@walletconnect/universal-provider'
import type { UniversalProviderOpts } from '@walletconnect/universal-provider'
import { WcHelpersUtil } from '../utils/HelpersUtil.js'
import type { AppKit } from '../client.js'
import type { SessionTypes } from '@walletconnect/types'
import type { CaipNetwork, CaipAddress, ChainNamespace, AdapterType } from '@reown/appkit-common'
import {
  SafeLocalStorage,
  SafeLocalStorageKeys,
  ConstantsUtil as CommonConstantsUtil
} from '@reown/appkit-common'
import { ProviderUtil } from '../store/index.js'
import type { AppKitOptions, AppKitOptionsWithCaipNetworks } from '../utils/TypesUtil.js'
import bs58 from 'bs58'

type Metadata = {
  name: string
  description: string
  url: string
  icons: string[]
}

// -- Client --------------------------------------------------------------------
export class UniversalAdapterClient {
  private walletConnectProviderInitPromise?: Promise<void>

  private appKit: AppKit | undefined = undefined

  public caipNetworks: [CaipNetwork, ...CaipNetwork[]]

  public walletConnectProvider?: UniversalProvider

  public metadata?: Metadata

  public isUniversalAdapterClient = true

  public chainNamespace: ChainNamespace

  public networkControllerClient: NetworkControllerClient

  public connectionControllerClient: ConnectionControllerClient

  public options: AppKitOptions | undefined = undefined

  public adapterType: AdapterType = 'universal'

  public reportedAlertErrors: Record<string, boolean> = {}

  public constructor(options: AppKitOptionsWithCaipNetworks) {
    const { metadata } = options

    this.caipNetworks = options.networks

    this.chainNamespace = CommonConstantsUtil.CHAIN.EVM

    this.metadata = metadata

    this.networkControllerClient = {
      // @ts-expect-error switchCaipNetwork is async for some adapter but not for this adapter
      switchCaipNetwork: caipNetwork => {
        if (caipNetwork) {
          this.switchNetwork(caipNetwork)
        }
      },

      getApprovedCaipNetworksData: async () => {
        const provider = await this.getWalletConnectProvider()

        if (!provider) {
          return Promise.resolve({
            supportsAllNetworks: false,
            approvedCaipNetworkIds: []
          })
        }

        const approvedCaipNetworkIds = WcHelpersUtil.getChainsFromNamespaces(
          provider.session?.namespaces
        )

        return Promise.resolve({
          supportsAllNetworks: false,
          approvedCaipNetworkIds
        })
      }
    }

    this.connectionControllerClient = {
      connectWalletConnect: async onUri => {
        const WalletConnectProvider = await this.getWalletConnectProvider()

        if (!WalletConnectProvider) {
          throw new Error('connectionControllerClient:getWalletConnectUri - provider is undefined')
        }

        WalletConnectProvider.on('display_uri', (uri: string) => {
          onUri(uri)
        })

        if (
          ChainController.state.activeChain &&
          ChainController.state?.chains?.get(ChainController.state.activeChain)?.adapterType ===
            'wagmi'
        ) {
          const adapter = ChainController.state.chains.get(ChainController.state.activeChain)
          await adapter?.connectionControllerClient?.connectWalletConnect?.(onUri)
        } else {
          const optionalNamespaces = WcHelpersUtil.createNamespaces(this.caipNetworks)
          await WalletConnectProvider.connect({ optionalNamespaces })
        }

        this.appKit?.setClientId(await WalletConnectProvider.client.core.crypto.getClientId())

        this.setWalletConnectProvider()
      },

      disconnect: async () => {
        SafeLocalStorage.removeItem(SafeLocalStorageKeys.WALLET_ID)

        await this.walletConnectProvider?.disconnect()

        this.appKit?.resetAccount(CommonConstantsUtil.CHAIN.EVM)
        this.appKit?.resetAccount(CommonConstantsUtil.CHAIN.SOLANA)
      },

      signMessage: async (message: string) => {
        const provider = await this.getWalletConnectProvider()
        const caipAddress = ChainController.state.activeCaipAddress
        const address = CoreHelperUtil.getPlainAddress(caipAddress)

        if (!provider) {
          throw new Error('connectionControllerClient:signMessage - provider is undefined')
        }

        let signature = ''

        if (
          ChainController.state.activeCaipNetwork?.chainNamespace ===
          CommonConstantsUtil.CHAIN.SOLANA
        ) {
          const response = await provider.request(
            {
              method: 'solana_signMessage',
              params: {
                message: bs58.encode(new TextEncoder().encode(message)),
                pubkey: address
              }
            },
            ChainController.state.activeCaipNetwork?.caipNetworkId
          )

          signature = (response as { signature: string }).signature
        } else {
          signature = await provider.request(
            {
              method: 'personal_sign',
              params: [message, address]
            },
            ChainController.state.activeCaipNetwork?.caipNetworkId
          )
        }

        return signature
      },

      estimateGas: async () => await Promise.resolve(BigInt(0)),
      // -- Transaction methods ---------------------------------------------------
      /**
       *
       * These methods are supported only on `wagmi` and `ethers` since the Solana SDK does not support them in the same way.
       * These function definition is to have a type parity between the clients. Currently not in use.
       */
      getEnsAvatar: async (value: string) => await Promise.resolve(value),

      getEnsAddress: async (value: string) => await Promise.resolve(value),

      writeContract: async () => await Promise.resolve('0x'),

      getCapabilities: async (params: string) => {
        const provider = await this.getWalletConnectProvider()

        if (!provider) {
          throw new Error('connectionControllerClient:getCapabilities - provider is undefined')
        }

        const walletCapabilitiesString = provider.session?.sessionProperties?.['capabilities']
        if (walletCapabilitiesString) {
          const walletCapabilities = this.parseWalletCapabilities(walletCapabilitiesString)
          const accountCapabilities = walletCapabilities[params]
          if (accountCapabilities) {
            return accountCapabilities
          }
        }

        return await provider.request({ method: 'wallet_getCapabilities', params: [params] })
      },

      grantPermissions: async (params: object | readonly unknown[]) => {
        const provider = await this.getWalletConnectProvider()
        if (!provider) {
          throw new Error('connectionControllerClient:grantPermissions - provider is undefined')
        }

        return provider.request({ method: 'wallet_grantPermissions', params })
      },
      revokePermissions: async session => {
        const provider = await this.getWalletConnectProvider()
        if (!provider) {
          throw new Error('connectionControllerClient:grantPermissions - provider is undefined')
        }

        return provider.request({ method: 'wallet_revokePermissions', params: [session] })
      },

      sendTransaction: async () => await Promise.resolve('0x'),

      parseUnits: () => BigInt(0),

      formatUnits: () => ''
    }

    ChainController.subscribeKey('activeCaipNetwork', val => {
      const caipAddress = this.appKit?.getCaipAddress(this.chainNamespace)

      if (val && caipAddress) {
        this.syncBalance(CoreHelperUtil.getPlainAddress(caipAddress) as `0x${string}`, val)
        this.syncAccount()
      }
    })
    ChainController.subscribeKey('activeCaipAddress', val => {
      const caipNetwork = ChainController.state.activeCaipNetwork
      if (val && caipNetwork) {
        this.syncBalance(CoreHelperUtil.getPlainAddress(val) as `0x${string}`, caipNetwork)
        this.syncAccount()
      }
    })
  }

  // -- Public ------------------------------------------------------------------
  public construct(appkit: AppKit, options: AppKitOptionsWithCaipNetworks) {
    this.appKit = appkit
    this.options = options

    this.createProvider()
    this.syncRequestedNetworks(this.caipNetworks)
    this.syncConnectors()
  }

  public switchNetwork(caipNetwork: CaipNetwork) {
    if (caipNetwork) {
      if (this.walletConnectProvider) {
        this.walletConnectProvider.setDefaultChain(caipNetwork.caipNetworkId)
      }
    }
  }

  public async disconnect() {
    if (this.walletConnectProvider) {
      await (this.walletConnectProvider as unknown as UniversalProvider).disconnect()
      this.appKit?.resetAccount(CommonConstantsUtil.CHAIN.EVM)
      this.appKit?.resetAccount(CommonConstantsUtil.CHAIN.SOLANA)
    }
  }

  public async getWalletConnectProvider() {
    if (!this.walletConnectProvider) {
      try {
        await this.createProvider()
      } catch (error) {
        throw new Error('EthereumAdapter:getWalletConnectProvider - Cannot create provider')
      }
    }

    return this.walletConnectProvider
  }

  // -- Private -----------------------------------------------------------------
  private async syncBalance(address: `0x${string}`, caipNetwork: CaipNetwork) {
    const isExistingNetwork = this.appKit
      ?.getCaipNetworks(caipNetwork.chainNamespace)
      .find(network => network.id === caipNetwork.id)

    // How to fetch balance on non-evm networks?
    if (caipNetwork && isExistingNetwork) {
      try {
        const { balances } = await BlockchainApiController.getBalance(
          address,
          String(caipNetwork.id)
        )
        const balance = balances.find(b => b.symbol === caipNetwork.nativeCurrency.symbol)
        this.appKit?.setBalance(
          balance?.quantity.numeric || '0',
          caipNetwork.nativeCurrency.symbol,
          this.chainNamespace
        )
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error fetching balance', error)
      }
    }
  }

  private createProvider() {
    if (
      !this.walletConnectProviderInitPromise &&
      typeof window !== 'undefined' &&
      this.options?.projectId
    ) {
      this.walletConnectProviderInitPromise = this.initWalletConnectProvider(
        this.options?.projectId
      )
    }

    return this.walletConnectProviderInitPromise
  }

  private handleAlertError(error: Error) {
    const matchedUniversalProviderError = Object.entries(ErrorUtil.UniversalProviderErrors).find(
      ([, { message }]) => error.message.includes(message)
    )

    const [errorKey, errorValue] = matchedUniversalProviderError ?? []

    const { message, alertErrorKey } = errorValue ?? {}

    if (errorKey && message && !this.reportedAlertErrors[errorKey]) {
      const alertError =
        ErrorUtil.ALERT_ERRORS[alertErrorKey as keyof typeof ErrorUtil.ALERT_ERRORS]

      if (alertError) {
        AlertController.open(alertError, 'error')
        this.reportedAlertErrors[errorKey] = true
      }
    }
  }

  private async initWalletConnectProvider(projectId: string) {
    const logger = LoggerUtil.createLogger((error, ...args) => {
      if (error) {
        this.handleAlertError(error)
      }
      // eslint-disable-next-line no-console
      console.error(...args)
    })

    const walletConnectProviderOptions: UniversalProviderOpts = {
      projectId,
      metadata: {
        name: this.metadata ? this.metadata.name : '',
        description: this.metadata ? this.metadata.description : '',
        url: this.metadata ? this.metadata.url : '',
        icons: this.metadata ? this.metadata.icons : ['']
      },
      logger
    }

    this.walletConnectProvider = await UniversalProvider.init(walletConnectProviderOptions)
    await this.checkActiveWalletConnectProvider()
  }

  private syncRequestedNetworks(caipNetworks: CaipNetwork[]) {
    const uniqueChainNamespaces = [
      ...new Set(caipNetworks.map(caipNetwork => caipNetwork.chainNamespace))
    ]
    uniqueChainNamespaces
      .filter(c => Boolean(c))
      .forEach(chainNamespace => {
        this.appKit?.setRequestedCaipNetworks(
          caipNetworks.filter(caipNetwork => caipNetwork.chainNamespace === chainNamespace),
          chainNamespace
        )
      })
  }

  private async checkActiveWalletConnectProvider() {
    const WalletConnectProvider = await this.getWalletConnectProvider()
    const walletId = SafeLocalStorage.getItem(SafeLocalStorageKeys.WALLET_ID)

    if (WalletConnectProvider) {
      if (walletId === ConstantsUtil.WALLET_CONNECT_CONNECTOR_ID) {
        this.setWalletConnectProvider()
      }
    }
  }

  private setWalletConnectProvider() {
    SafeLocalStorage.setItem(
      SafeLocalStorageKeys.WALLET_ID,
      ConstantsUtil.WALLET_CONNECT_CONNECTOR_ID
    )

    const nameSpaces = this.walletConnectProvider?.session?.namespaces

    if (nameSpaces) {
      const reversedChainNamespaces = Object.keys(nameSpaces).reverse() as ChainNamespace[]
      reversedChainNamespaces.forEach(chainNamespace => {
        const caipAddress = nameSpaces?.[chainNamespace]?.accounts[0] as CaipAddress | undefined

        ProviderUtil.setProvider(chainNamespace, this.walletConnectProvider)
        ProviderUtil.setProviderId(chainNamespace, 'walletConnect')
        this.appKit?.setApprovedCaipNetworksData(chainNamespace)

        if (caipAddress) {
          this.appKit?.setCaipAddress(caipAddress, chainNamespace)
        }
      })

      const storedCaipNetwork = StorageUtil.getStoredActiveCaipNetwork()
      const activeCaipNetwork = ChainController.state.activeCaipNetwork
      try {
        if (storedCaipNetwork) {
          ChainController.setActiveCaipNetwork(storedCaipNetwork)
        } else if (
          !activeCaipNetwork ||
          !ChainController.getAllApprovedCaipNetworkIds().includes(activeCaipNetwork.caipNetworkId)
        ) {
          this.setDefaultNetwork(nameSpaces)
        }
      } catch (error) {
        console.warn('>>> Error setting active caip network', error)
      }
    }

    this.syncAccount()
    this.watchWalletConnect()
  }

  private setDefaultNetwork(nameSpaces: SessionTypes.Namespaces) {
    const chainNamespace = this.caipNetworks[0]?.chainNamespace
    if (chainNamespace) {
      const namespace = nameSpaces?.[chainNamespace]

      if (namespace?.chains) {
        const chainId = namespace.chains[0]

        if (chainId) {
          const requestedCaipNetworks = ChainController.getRequestedCaipNetworks(chainNamespace)

          if (requestedCaipNetworks) {
            const network = requestedCaipNetworks.find(c => c.caipNetworkId === chainId)

            if (network) {
              ChainController.setActiveCaipNetwork(network as unknown as CaipNetwork)
            }
          }
        }
      }
    }
  }

  private async watchWalletConnect() {
    const provider = await this.getWalletConnectProvider()
    const namespaces = provider?.session?.namespaces || {}

    function disconnectHandler() {
      Object.keys(namespaces).forEach(key => {
        AccountController.resetAccount(key as ChainNamespace)
      })
      ConnectionController.resetWcConnection()

      SafeLocalStorage.removeItem(SafeLocalStorageKeys.WALLET_ID)

      provider?.removeListener('disconnect', disconnectHandler)
      provider?.removeListener('accountsChanged', accountsChangedHandler)
    }

    const accountsChangedHandler = (accounts: string[]) => {
      if (accounts.length > 0) {
        this.syncAccount()
      }
    }

    const chainChanged = (chainId: number | string) => {
      // eslint-disable-next-line eqeqeq
      const caipNetwork = this.caipNetworks.find(c => c.id == chainId)
      const currentCaipNetwork = this.appKit?.getCaipNetwork()

      if (!caipNetwork) {
        const namespace = this.appKit?.getActiveChainNamespace() || CommonConstantsUtil.CHAIN.EVM
        ChainController.setActiveCaipNetwork({
          id: chainId,
          caipNetworkId: `${namespace}:${chainId}`,
          name: 'Unknown Network',
          chainNamespace: namespace,
          nativeCurrency: {
            name: '',
            decimals: 0,
            symbol: ''
          },
          rpcUrls: {
            default: {
              http: []
            }
          }
        })

        return
      }

      if (!currentCaipNetwork || currentCaipNetwork?.id !== caipNetwork?.id) {
        this.appKit?.setCaipNetwork(caipNetwork)
      }
    }

    if (provider) {
      provider.on('disconnect', disconnectHandler)
      provider.on('accountsChanged', accountsChangedHandler)
      provider.on('chainChanged', chainChanged)
      provider.on('connect', this.syncAccount.bind(this))
    }
  }

  private getProviderData() {
    const namespaces = this.walletConnectProvider?.session?.namespaces || {}

    const isConnected = this.appKit?.getIsConnectedState() || false
    const preferredAccountType = this.appKit?.getPreferredAccountType() || ''

    return {
      provider: this.walletConnectProvider,
      namespaces,
      namespaceKeys: namespaces ? Object.keys(namespaces) : [],
      isConnected,
      preferredAccountType
    }
  }

  private syncAccount() {
    const { namespaceKeys, namespaces } = this.getProviderData()

    const preferredAccountType = this.appKit?.getPreferredAccountType()

    const isConnected = this.appKit?.getIsConnectedState() || false

    if (isConnected) {
      namespaceKeys.forEach(async key => {
        const chainNamespace = key as ChainNamespace
        const address = namespaces?.[key]?.accounts[0] as CaipAddress
        const isNamespaceConnected = this.appKit?.getCaipAddress(chainNamespace)

        if (!isNamespaceConnected) {
          this.appKit?.setPreferredAccountType(preferredAccountType, chainNamespace)
          this.appKit?.setCaipAddress(address, chainNamespace)
          this.syncConnectedWalletInfo()
          await Promise.all([this.appKit?.setApprovedCaipNetworksData(chainNamespace)])
        }

        this.syncAccounts()
      })
    } else {
      this.appKit?.resetWcConnection()
      this.appKit?.resetNetwork(this.chainNamespace)
      this.syncAccounts(true)
    }
  }

  private syncAccounts(reset = false) {
    const { namespaces } = this.getProviderData()
    const chainNamespaces = Object.keys(namespaces) as ChainNamespace[]

    chainNamespaces.forEach(chainNamespace => {
      const addresses = namespaces?.[chainNamespace]?.accounts
        ?.map(account => {
          const [, , address] = account.split(':')

          return address
        })
        .filter((address, index, self) => self.indexOf(address) === index) as string[]

      if (reset) {
        this.appKit?.setAllAccounts([], chainNamespace)
      }

      if (addresses) {
        this.appKit?.setAllAccounts(
          addresses.map(address => ({ address, type: 'eoa' })),
          chainNamespace
        )
      }
    })
  }

  private syncConnectedWalletInfo() {
    const currentActiveWallet = SafeLocalStorage.getItem(SafeLocalStorageKeys.WALLET_ID)
    const namespaces = this.walletConnectProvider?.session?.namespaces || {}
    const chainNamespaces = Object.keys(namespaces) as ChainNamespace[]

    chainNamespaces.forEach(chainNamespace => {
      if (this.walletConnectProvider?.session) {
        this.appKit?.setConnectedWalletInfo(
          {
            ...this.walletConnectProvider.session.peer.metadata,
            name: this.walletConnectProvider.session.peer.metadata.name,
            icon: this.walletConnectProvider.session.peer.metadata.icons?.[0]
          },
          chainNamespace
        )
      } else if (currentActiveWallet) {
        this.appKit?.setConnectedWalletInfo(
          { name: currentActiveWallet },
          CommonConstantsUtil.CHAIN.EVM
        )
        this.appKit?.setConnectedWalletInfo(
          { name: currentActiveWallet },
          CommonConstantsUtil.CHAIN.SOLANA
        )
      }
    })
  }

  private syncConnectors() {
    const w3mConnectors: Connector[] = []

    w3mConnectors.push({
      id: ConstantsUtil.WALLET_CONNECT_CONNECTOR_ID,
      explorerId: PresetsUtil.ConnectorExplorerIds[ConstantsUtil.WALLET_CONNECT_CONNECTOR_ID],
      imageId: PresetsUtil.ConnectorImageIds[ConstantsUtil.WALLET_CONNECT_CONNECTOR_ID],
      name: PresetsUtil.ConnectorNamesMap[ConstantsUtil.WALLET_CONNECT_CONNECTOR_ID],
      type: 'WALLET_CONNECT',
      chain: this.chainNamespace
    })

    this.appKit?.setConnectors(w3mConnectors)
  }
  private parseWalletCapabilities(walletCapabilitiesString: string) {
    try {
      const walletCapabilities = JSON.parse(walletCapabilitiesString)

      return walletCapabilities
    } catch (error) {
      throw new Error('Error parsing wallet capabilities')
    }
  }
}
