import { html, LitElement } from 'lit'
import { property } from 'lit/decorators.js'
import '../../components/wui-icon/index.js'
import '../../components/wui-text/index.js'
import { elementStyles, resetStyles } from '../../utils/ThemeUtil.js'
import type { ButtonSize, ButtonLinkVariant } from '../../utils/TypeUtil.js'
import { customElement } from '../../utils/WebComponentsUtil.js'
import styles from './styles.js'

// -- Constants ------------------------------------------ //

const TEXT_VARIANT_BY_SIZE = {
  sm: 'sm-medium',
  md: 'md-medium'
}

const TEXT_COLOR_BY_VARIANT = {
  accent: 'accent-primary',
  secondary: 'secondary'
}

const ICON_SIZE_BY_SIZE = {
  sm: '3xs',
  md: 'xxs'
}

@customElement('wui-link')
export class WuiLink extends LitElement {
  public static override styles = [resetStyles, elementStyles, styles]

  // -- State & Properties -------------------------------- //
  @property() public size: Exclude<ButtonSize, 'lg'> = 'md'

  @property({ type: Boolean }) public disabled = false

  @property() public variant: ButtonLinkVariant = 'accent'

  // -- Render -------------------------------------------- //
  public override render() {
    const textVariant = TEXT_VARIANT_BY_SIZE[this.size]
    const textColor = TEXT_COLOR_BY_VARIANT[this.variant]
    const iconSize = ICON_SIZE_BY_SIZE[this.size]

    return html`
      <button ?disabled=${this.disabled} data-variant=${this.variant} ontouchstart>
        <wui-text color=${textColor} variant=${textVariant}>
          <slot></slot>
        </wui-text>
        <wui-icon size=${iconSize} name="arrowTopRight"></wui-icon>
      </button>
    `
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-link': WuiLink
  }
}
