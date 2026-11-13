/** Longest dictation in seconds; the indicator stops the recording at this point. */
export const MAX_RECORDING_DURATION = 180

/** The longest duration main accepts from the indicator: the limit plus a little slack. */
export const MAX_REPORTED_DURATION_MS = (MAX_RECORDING_DURATION + 5) * 1000
