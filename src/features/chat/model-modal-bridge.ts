/**
 * Tiny event bridge for opening the model configuration modal from modules that
 * should not import or own the modal host directly.
 */
type Listener = () => void

let listener: Listener | null = null

export function onOpenModelConfig(cb: Listener): () => void {
  listener = cb
  return () => {
    if (listener === cb) listener = null
  }
}

export function openModelConfigModal(): void {
  listener?.()
}
