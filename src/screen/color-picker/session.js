// Popup and embedded color-space pickers share one active paint color without
// forcing the rest of the editor to depend on picker DOM internals.
export const pickerSession = {
  popupRoot: null,
  popupApply: null,
  spaceRoot: null,
  spaceApply: null
};
