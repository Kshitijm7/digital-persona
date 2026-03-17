export function patchOrbitControlsPassiveListeners() {
  if (typeof window === "undefined") return;

  // Store the original addEventListener
  const originalAddEventListener = EventTarget.prototype.addEventListener;

  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) {
    // Force wheel and touch events to be passive on canvas elements
    if (
      (type === "wheel" || type === "touchstart" || type === "touchmove") &&
      this instanceof HTMLCanvasElement
    ) {
      const newOptions: AddEventListenerOptions =
        typeof options === "object"
          ? { ...options, passive: true }
          : { passive: true, capture: typeof options === "boolean" ? options : false };
      return originalAddEventListener.call(this, type, listener, newOptions);
    }
    return originalAddEventListener.call(this, type, listener, options);
  };
}
