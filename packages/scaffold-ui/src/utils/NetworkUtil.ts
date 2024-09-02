import { ConstantsUtil } from '@web3modal/common'
import { ChainController, OptionsController, RouterUtil } from '@web3modal/core'

export const NetworkUtil = {
  onNetworkChange: async () => {
    const isEIP155Namespace = ChainController.state.activeChain === ConstantsUtil.CHAIN.EIP155
    if (OptionsController.state.isSiweEnabled) {
      const { SIWEController } = await import('@web3modal/siwe')
      if (SIWEController.state._client?.options?.signOutOnNetworkChange && isEIP155Namespace) {
        await SIWEController.signOut()
      } else {
        RouterUtil.navigateAfterNetworkSwitch()
      }
    } else {
      RouterUtil.navigateAfterNetworkSwitch()
    }
  }
}
