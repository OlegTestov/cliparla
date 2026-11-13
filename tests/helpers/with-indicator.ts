/**
 * Import this after the Electron test double to give tests an indicator window whose page has
 * loaded. Without a window the indicator is not usable and no dictation starts.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const windowManager = require('../../src/main/core/window-manager')

windowManager.registerDefaultWindows()
windowManager.createAll()
