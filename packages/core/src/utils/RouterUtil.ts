import { closeModal } from '../controllers/ModalController.js'
import { RouterController } from '../controllers/RouterController.js'

export const RouterUtil = {
  goBackOrCloseModal() {
    if (RouterController.state.history.length > 1) {
      RouterController.goBack()
    } else {
      closeModal()
    }
  },
  navigateAfterNetworkSwitch() {
    const { history } = RouterController.state
    const networkSelectIndex = history.findIndex(name => name === 'Networks')

    if (networkSelectIndex >= 1) {
      RouterController.goBackToIndex(networkSelectIndex - 1)
    } else {
      closeModal()
    }
  }
}
