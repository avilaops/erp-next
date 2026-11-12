/** Guard same-document browser traversals before Next.js changes its route. */
export function guardBrowserHistory(confirmNavigation: () => boolean, target: Window = window) {
  const navigation = (target as Window & { navigation?: EventTarget }).navigation
  if (navigation) {
    const guard = (event: Event) => {
      const traversal = event as Event & { navigationType?: string; destination?: { sameDocument?: boolean } }
      if (traversal.navigationType === "traverse" && traversal.destination?.sameDocument && event.cancelable && !confirmNavigation()) event.preventDefault()
    }
    navigation.addEventListener("navigate", guard)
    return () => navigation.removeEventListener("navigate", guard)
  }

  // Older engines have no cancellable Navigation API. The root-layout bootstrap
  // runs before Next's listener: its handler must not unmount editors first.
  const history = target.history
  const bridge = target as Window & { __erpHistoryBootstrapped?: boolean; __erpHistoryGuard?: (event: PopStateEvent) => void }
  const marker = "__erpNavigationIndex"
  let index = Number.isSafeInteger(history.state?.[marker]) ? history.state[marker] as number : 0
  let restoring = false
  const push = history.pushState
  const replace = history.replaceState
  const pushState: History["pushState"] = function (data, unused, url) {
    push.call(history, { ...data, [marker]: index + 1 }, unused, url)
    index++
  }
  const replaceState: History["replaceState"] = function (data, unused, url) {
    replace.call(history, { ...data, [marker]: index }, unused, url)
  }
  replace.call(history, { ...history.state, [marker]: index }, "")
  history.pushState = pushState
  history.replaceState = replaceState
  const guard = (event: PopStateEvent) => {
    if (restoring) { restoring = false; event.stopImmediatePropagation(); return }
    const next = Number.isSafeInteger(event.state?.[marker]) ? event.state[marker] as number : index - 1
    if (!confirmNavigation()) {
      event.stopImmediatePropagation()
      restoring = true
      history.go(index - next || 1)
    } else {
      index = next
      if (!Number.isSafeInteger(event.state?.[marker])) replace.call(history, { ...event.state, [marker]: index }, "")
    }
  }
  const previousGuard = bridge.__erpHistoryGuard
  if (bridge.__erpHistoryBootstrapped) bridge.__erpHistoryGuard = guard
  else target.addEventListener("popstate", guard, true)
  return () => {
    target.removeEventListener("popstate", guard, true)
    if (bridge.__erpHistoryGuard === guard) bridge.__erpHistoryGuard = previousGuard
    if (history.pushState === pushState) history.pushState = push
    if (history.replaceState === replaceState) history.replaceState = replace
  }
}
