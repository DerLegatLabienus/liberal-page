import { useState, useEffect } from 'react'

export type Direction = 'rtl' | 'ltr'

export function useDirection(): Direction {
  const getDir = (): Direction => {
    const dir = document.documentElement.getAttribute('dir')
    return dir === 'ltr' ? 'ltr' : 'rtl'
  }

  const [direction, setDirection] = useState<Direction>(getDir)

  useEffect(() => {
    const observer = new MutationObserver(() => setDirection(getDir()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['dir'],
    })
    return () => observer.disconnect()
  }, [])

  return direction
}
