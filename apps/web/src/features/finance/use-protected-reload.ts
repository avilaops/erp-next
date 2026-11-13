"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

// A reload may unmount a command owner, including on a failed GET. Keep it
// queued until both sibling commands have a definitive result.
export function useProtectedReload(reload: () => void) {
  const reloadRef = useRef(reload)
  useLayoutEffect(() => { reloadRef.current = reload })
  const locks = useRef([false, false])
  const pending = useRef(false)
  const [state, setState] = useState([false, false])
  const setLock = useCallback((index: number, locked: boolean) => {
    locks.current[index] = locked
    setState(previous => previous[index] === locked ? previous : previous.map((value, i) => i === index ? locked : value))
  }, [])
  const setPrimaryLocked = useCallback((locked: boolean) => setLock(0, locked), [setLock])
  const setSecondaryLocked = useCallback((locked: boolean) => setLock(1, locked), [setLock])
  const isLocked = useCallback(() => locks.current.some(Boolean), [])
  const guardedReload = useCallback(() => {
    if (locks.current.some(Boolean)) pending.current = true
    else reloadRef.current()
  }, [])
  useEffect(() => {
    if (!state.some(Boolean) && pending.current && !locks.current.some(Boolean)) {
      pending.current = false
      reloadRef.current()
    }
  }, [state])
  return { primaryLocked: state[0], secondaryLocked: state[1], locked: state.some(Boolean), setPrimaryLocked, setSecondaryLocked, isLocked, reload: guardedReload }
}
