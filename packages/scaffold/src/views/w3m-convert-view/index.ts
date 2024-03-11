import { customElement, formatNumberToLocalString } from '@web3modal/ui'
import { LitElement, html } from 'lit'
import { state } from 'lit/decorators.js'
import styles from './styles.js'
import {
  SwapApiController,
  RouterController,
  CoreHelperUtil,
  NetworkController,
  ConnectionController,
  ModalController
} from '@web3modal/core'
import type { TokenInfo } from '@web3modal/core/src/controllers/SwapApiController.js'

type Target = 'sourceToken' | 'toToken'

@customElement('w3m-convert-view')
export class W3mConvertView extends LitElement {
  public static override styles = styles

  private unsubscribe: ((() => void) | undefined)[] = []

  // -- State & Properties -------------------------------- //
  @state() private caipNetworkId = NetworkController.state.caipNetwork?.id

  @state() private initialLoading = SwapApiController.state.initialLoading

  @state() private isTransactionPending = SwapApiController.state.isTransactionPending

  @state() private loading = SwapApiController.state.loading

  @state() private loadingPrices = SwapApiController.state.loadingPrices

  @state() private sourceToken = SwapApiController.state.sourceToken

  @state() private sourceTokenAmount = SwapApiController.state.sourceTokenAmount

  @state() private sourceTokenPriceInUSD = SwapApiController.state.sourceTokenPriceInUSD

  @state() private toToken = SwapApiController.state.toToken

  @state() private toTokenAmount = SwapApiController.state.toTokenAmount

  @state() private toTokenPriceInUSD = SwapApiController.state.toTokenPriceInUSD

  @state() private hasAllowance = SwapApiController.state.hasAllowance

  @state() private gasPriceInUSD = SwapApiController.state.gasPriceInUSD

  @state() private gasPriceInETH = SwapApiController.state.gasPriceInETH

  @state() private priceImpact = SwapApiController.state.priceImpact

  @state() private maxSlippage = SwapApiController.state.maxSlippage

  @state() private swapErrorMessage = SwapApiController.state.swapErrorMessage

  // -- Lifecycle ----------------------------------------- //
  public constructor() {
    super()

    NetworkController.subscribeKey('caipNetwork', newCaipNetwork => {
      if (this.caipNetworkId !== newCaipNetwork?.id) {
        this.caipNetworkId = newCaipNetwork?.id
        SwapApiController.setSourceToken(undefined)
        SwapApiController.setToToken(undefined)
        SwapApiController.clearMyTokens()
        SwapApiController.clearTokens()
        SwapApiController.getTokenList({ forceRefetch: true })
      }
    })

    this.unsubscribe.push(
      ...[
        ModalController.subscribeKey('open', isOpen => {
          if (!isOpen) {
            SwapApiController.resetState()
          }
        }),
        RouterController.subscribeKey('view', newRoute => {
          if (!newRoute.includes('Convert')) {
            SwapApiController.resetState()
          }
        }),
        SwapApiController.subscribeKey('sourceToken', newSourceToken => {
          this.sourceToken = newSourceToken
        }),
        SwapApiController.subscribeKey('toToken', newToToken => {
          this.toToken = newToToken
        }),
        SwapApiController.subscribe(newState => {
          this.initialLoading = newState.initialLoading
          this.isTransactionPending = newState.isTransactionPending
          this.loading = newState.loading
          this.loadingPrices = newState.loadingPrices
          this.sourceToken = newState.sourceToken
          this.sourceTokenAmount = newState.sourceTokenAmount
          this.sourceTokenPriceInUSD = newState.sourceTokenPriceInUSD
          this.toToken = newState.toToken
          this.toTokenAmount = newState.toTokenAmount
          this.toTokenPriceInUSD = newState.toTokenPriceInUSD
          this.hasAllowance = newState.hasAllowance
          this.gasPriceInUSD = newState.gasPriceInUSD
          this.gasPriceInETH = newState.gasPriceInETH
          this.swapErrorMessage = newState.swapErrorMessage
          this.priceImpact = newState.priceImpact
          this.maxSlippage = newState.maxSlippage
        })
      ]
    )
  }

  public override firstUpdated() {
    if (!this.initialLoading) {
      SwapApiController.getTokenList()
    }
  }

  public override disconnectedCallback() {
    this.unsubscribe.forEach(unsubscribe => unsubscribe?.())
  }

  // -- Render -------------------------------------------- //
  public override render() {
    return html`
      <wui-flex flexDirection="column" padding="s" gap="s">
        ${this.initialLoading || this.isTransactionPending
          ? this.templateLoading()
          : this.templateSwap()}
      </wui-flex>
    `
  }

  // -- Private ------------------------------------------- //
  private templateSwap() {
    return html`
      <wui-flex flexDirection="column" gap="s">
        <wui-flex
          flexDirection="column"
          alignItems="center"
          gap="xs"
          class="convert-inputs-container"
        >
          ${this.templateTokenInput('sourceToken', this.sourceToken)}
          ${this.templateTokenInput('toToken', this.toToken)} ${this.templateReplaceTokensButton()}
        </wui-flex>
        ${this.templateDetails()} ${this.templateActionButton()}
      </wui-flex>
    `
  }

  private actionButtonLabel(): string {
    const myToken = SwapApiController.state.myTokensWithBalance?.[this.sourceToken?.address ?? '']
    const myTokenAmount = myToken
      ? parseFloat(
          ConnectionController.formatUnits(BigInt(myToken.balance), myToken.decimals)
        ).toFixed(3)
      : 0

    if (myTokenAmount === 0) {
      return 'Insufficient funds'
    }

    if (this.swapErrorMessage) {
      if (this.swapErrorMessage?.includes('insufficient funds')) {
        return 'Insufficient funds'
      }

      return 'Error'
    }

    if (!this.toToken || !this.sourceToken) {
      return 'Select token'
    }

    if (!this.toTokenAmount || !this.sourceTokenAmount) {
      return 'Enter amount'
    }

    return this.hasAllowance ? 'Review convert' : 'Not permitted'
  }

  private templateReplaceTokensButton() {
    return html`
      <div class="replace-tokens-button-container" @click=${this.onSwitchTokens.bind(this)}>
        <button class="replace-tokens-button">
          <svg
            width="20"
            height="20"
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
          >
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M8.30713 0.292893C8.69766 0.683417 8.69766 1.31658 8.30713 1.70711L6.41424 3.6H11.3404C13.8369 3.6 16.0533 5.1975 16.8427 7.56588L16.9487 7.88377C17.1234 8.40772 16.8402 8.97404 16.3163 9.14868C15.7923 9.32333 15.226 9.04017 15.0513 8.51623L14.9454 8.19834C14.4281 6.64664 12.976 5.6 11.3404 5.6H6.41424L8.30713 7.49289C8.69766 7.88342 8.69766 8.51658 8.30713 8.90711C7.91661 9.29763 7.28344 9.29763 6.89292 8.90711L3.29292 5.30711C2.9024 4.91658 2.9024 4.28342 3.29292 3.89289L6.89292 0.292893C7.28344 -0.0976311 7.91661 -0.0976311 8.30713 0.292893ZM3.6838 10.8513C4.20774 10.6767 4.77406 10.9598 4.94871 11.4838L5.05467 11.8017C5.57191 13.3534 7.02404 14.4 8.65967 14.4L13.5858 14.4L11.6929 12.5071C11.3024 12.1166 11.3024 11.4834 11.6929 11.0929C12.0834 10.7024 12.7166 10.7024 13.1071 11.0929L16.7071 14.6929C17.0977 15.0834 17.0977 15.7166 16.7071 16.1071L13.1071 19.7071C12.7166 20.0976 12.0834 20.0976 11.6929 19.7071C11.3024 19.3166 11.3024 18.6834 11.6929 18.2929L13.5858 16.4L8.65967 16.4C6.16317 16.4 3.94677 14.8025 3.15731 12.4341L3.05134 12.1162C2.8767 11.5923 3.15986 11.026 3.6838 10.8513Z"
              fill="#788181"
            />
          </svg>
        </button>
      </div>
    `
  }

  private templateLoading() {
    return html`<wui-flex
      flexGrow="1"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
      .padding=${['3xl', 'xl', '3xl', 'xl'] as const}
      gap="xl"
    >
      <wui-icon-box
        backgroundColor="glass-005"
        background="gray"
        iconColor="fg-200"
        icon="swapHorizontalRoundedBold"
        size="lg"
        ?border=${true}
        borderColor="wui-color-bg-125"
      ></wui-icon-box>

      <wui-loading-hexagon></wui-loading-hexagon>
    </wui-flex>`
  }

  private templateTokenInput(target: Target, token?: TokenInfo) {
    const myToken = SwapApiController.state.myTokensWithBalance?.[token?.address ?? '']
    const amount = target === 'toToken' ? this.toTokenAmount : this.sourceTokenAmount
    const price = target === 'toToken' ? this.toTokenPriceInUSD : this.sourceTokenPriceInUSD
    const value = parseFloat(amount) * price

    return html`<wui-convert-input
      .value=${target === 'toToken' ? this.toTokenAmount : this.sourceTokenAmount}
      ?disabled=${this.loading && target === 'toToken'}
      .onSetAmount=${this.handleChangeAmount.bind(this)}
      target=${target}
      .token=${token}
      .balance=${myToken?.balance}
      .marketValue=${isNaN(value) ? '' : formatNumberToLocalString(value)}
      amount=${myToken
        ? formatNumberToLocalString(
            ConnectionController.formatUnits(BigInt(myToken.balance), myToken.decimals),
            3
          )
        : 0}
    ></wui-convert-input>`
  }

  private templateDetails() {
    if (!this.sourceToken || !this.toToken || !this.sourceTokenAmount || !this.toTokenAmount) {
      return null
    }

    const toTokenConvertedAmount =
      this.sourceTokenPriceInUSD && this.toTokenPriceInUSD
        ? (1 / this.toTokenPriceInUSD) * this.sourceTokenPriceInUSD
        : 0

    return html`
      <wui-convert-details
        defaultOpen=${false}
        sourceTokenSymbol=${this.sourceToken?.symbol}
        sourceTokenPrice=${this.sourceTokenPriceInUSD}
        toTokenSymbol=${this.toToken?.symbol}
        toTokenConvertedAmount=${toTokenConvertedAmount}
        gasPriceInETH=${this.gasPriceInETH}
        gasPriceInUSD=${this.gasPriceInUSD}
        .priceImpact=${this.priceImpact}
        slippageRate=${0.5}
        .maxSlippage=${this.maxSlippage}
      ></wui-convert-details>
    `
  }

  private handleChangeAmount(target: Target, value: string) {
    if (target === 'sourceToken') {
      SwapApiController.setSourceTokenAmount(value)
    } else {
      SwapApiController.setToTokenAmount(value)
    }
    SwapApiController.clearError()
    this.onDebouncedGetSwapCalldata()
  }

  private templateActionButton() {
    const haveNoTokenSelected = !this.toToken || !this.sourceToken
    const loading = this.loadingPrices || this.loading

    return html` <wui-flex gap="xs">
      <wui-button
        class="action-button"
        ?fullWidth=${true}
        size="lg"
        borderRadius="xs"
        variant=${!this.hasAllowance || haveNoTokenSelected ? 'shade' : 'fill'}
        .loading=${loading}
        .disabled=${loading || !this.hasAllowance || haveNoTokenSelected || this.swapErrorMessage}
        @click=${this.onConvertPreview}
      >
        ${this.actionButtonLabel()}
      </wui-button>
    </wui-flex>`
  }

  private onDebouncedGetSwapCalldata = CoreHelperUtil.debounce(async () => {
    await SwapApiController.getTokenSwapInfo()
  }, 500)

  private onSwitchTokens() {
    SwapApiController.switchTokens()
  }

  private onConvertPreview() {
    RouterController.push('ConvertPreview')
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'w3m-convert-view': W3mConvertView
  }
}
