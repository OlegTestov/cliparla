/**
 * App identity. Must be imported before anything that touches app.getPath('userData')
 * (electron-store does at import time), so Cliparla keeps its own data directory.
 */

import { app } from 'electron'
import path from 'path'
import { APP_NAME } from '../../shared/app-info'
import { configureLogger } from './logger'

configureLogger({ packaged: app.isPackaged })
app.setName(APP_NAME)

// An explicit --user-data-dir (tests, support runs) wins over our default folder
if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), APP_NAME))
}
