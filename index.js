'use strict'

/**
 * @typedef {Object} packageJson
 * @property {string} author
 * @property {string} author.name
 * @property {string} name
 * @property {string} productName
 * @property {string} version
 */

/**
 * Modules
 * Node
 * @constant
 */
const { EventEmitter } = require('events')
const os = require('os')
const path = require('path')

/**
 * Modules
 * Electron
 * @constant
 */
const electron = require('electron')
const { app, BrowserWindow } = electron

/**
 * Modules
 * External
 * @constant
 */
const appRootPath = require('app-root-path')
const dialogProvider = require('@bengennaria/electron-dialog-provider')
const ElectronStore = require('electron-store')
const logger = require('@bengennaria/logger')({ write: true })
const notificationProvider = require('@bengennaria/electron-notification-provider')
const platformTools = require('@bengennaria/platform-tools')
const prettyBytes = require('pretty-bytes')
const projectNameGenerator = require('project-name-generator')
const randomInt = require('random-int')
const removeMarkdown = require('remove-markdown')
const semverCompare = require('semver-compare')
const semver = require('semver')
const { autoUpdater } = require('electron-updater')

/**
 * Module Configuration
 */
autoUpdater.logger = logger

/**
 * Modules
 * Internal
 * @constant
 */
const packageJson = require(path.join(appRootPath['path'], 'package.json'))

/** @namespace global */


/**
 * Application
 * @constant
 * @default
 */
const appName = packageJson.name || app.name
const appProductName = packageJson.productName || packageJson.name || appName
const appCurrentVersion = packageJson.version || app.getVersion()

/**
 * Modules
 * Configuration
 */
const storeId = `${appName}.electron-updater-service`
const store = new ElectronStore({ name: storeId, cwd: app.getPath('userData') })

/**
 * Get mainWindow
 * @return {Electron.BrowserWindow}
 */
let getMainWindow = () => BrowserWindow.getAllWindows()[0]


/**
 * Retrieve appReleaseNotes
 * @return {String} - Release Notes (Plaintext)
 */
let retrieveAppReleaseNotes = () => store.get('appReleaseNotes')

/**
 * Store appReleaseNotes
 * @param {String} appReleaseNotes - Release Notes (Plaintext)
 * @returns {*}
 */
let storeAppReleaseNotes = (appReleaseNotes) => store.set('appReleaseNotes', appReleaseNotes)

/**
 * Retrieve appLastVersion
 * @return {String} - Last Version
 */
let retrieveAppLastVersion = () => store.get('appLastVersion')

/**
 * Store appLastVersion
 * @param {String} appLastVersion - Last Version
 * @returns {*}
 */
let storeAppLastVersion = (appLastVersion) => store.set('appLastVersion', appLastVersion)


/**
 * Durations in milliseconds
 * @constant {Number}
 */
const updateRequestIntervalDuration = 1800000


/**
 * Singleton App Updater Service Interface
 * @class UpdaterService
 * @extends EventEmitter
 * @property {Boolean} isEnabled - Application updates are enabled
 * @property {Boolean} isBusy - Application update already in progress
 * @property {Number} requestIntervalHandler - setInterval handler
 * @property {Number} lastUpdateSize - Payload size of last update
 */
class UpdaterService extends EventEmitter {
    /** @constructor */
    constructor() {
        logger.debug('constructor')

        // Super
        super()

        // Init
        this.isEnabled = true
        this.isBusy = false
        this.requestIntervalHandler = 0
        this.lastUpdateSize = 0

        this.init()
    }

    /**
     * Init
     * @private
     */
    init() {
        logger.debug('init')

        // Require purpose-built binary
        if (process.defaultApp) {
            logger.warn('AutoUpdater requires non-default Electron binary')
        }

        // Requires macOS or Windows
        if (platformTools.isLinux) {
            logger.warn('AutoUpdater not supported on Linux')
        }

        if (!process.defaultApp && !platformTools.isLinux) {
            // Wire up logger interface
            // autoUpdater.logger = electronLog

            // Register AutoUpdater events
            this.registerUpdaterEventHandlers()

            // Register Update request triggers
            this.registerEventTriggers()
            this.registerTimedTriggers()

            // Handle recent update since last launch
            this.checkRecentUpdate()
        }
    }

    /**
     * Register Electron.AutoUpdater events
     * @private
     */
    registerUpdaterEventHandlers() {
        logger.debug('registerAppUpdaterEvents()')

        /**
         * @listens Electron.AutoUpdater#error
         */
        autoUpdater.on('error', (error) => {
            logger.debug('autoUpdater#error')

            // Status
            logger.error('Application Updates', 'Error:', error)

            // Block further updates
            this.isBusy = true

            // Show Notification: "update error"
            const notification = notificationProvider.create({
                title: `${appProductName} update error`,
                body: `There was a problem updating ${appProductName}:` +
                    `${os.EOL}${os.EOL}${error.message}`
            })

            /** @listens notification#show */
            notification.on('show', () => logger.debug('autoUpdater#error', 'notification:', notification))

            // Show Notification
            notification.show()
        })

        /**
         * @listens Electron.AutoUpdater:checking-for-update
         */
        autoUpdater.on('checking-for-update', () => {
            logger.debug('autoUpdater#checking-for-update')

            // Block further updates
            this.isBusy = true
        })

        /**
         * @listens Electron.AutoUpdater:update-available
         */
        autoUpdater.on('update-available', (/** Object */ updateInfo) => {
            logger.debug('autoUpdater#update-available', updateInfo)

            // Status
            logger.info('Application Update', 'Update are available')

            // Block further updates
            this.isBusy = true

            // Show Notification: "Application Update available"
            const notification = notificationProvider.create({
                title: 'Application Update available',
                subtitle: `Currently using ${appProductName} ${appCurrentVersion}`,
                body: `Downloading ${updateInfo.version} update..`,
                silent: false
            })

            /** @listens notification#show */
            notification.on('show', () => logger.debug('autoUpdater#update-available', 'notification:', notification))

            // Show Notification
            notification.show()
        })

        /**
         * @listens Electron.AutoUpdater:update-not-available
         */
        autoUpdater.on('update-not-available', () => {
            logger.debug('autoUpdater#update-not-available')

            // Status
            logger.info('Application Update', 'No updates available')

            // Allow further updates
            this.isBusy = false
        })

        /**
         * @listens Electron.AutoUpdater:download-progress
         */
        autoUpdater.on('download-progress', (/** Object */ progressInfo) => {
            logger.debug('autoUpdater#download-progress', progressInfo)

            // Block further updates
            this.isBusy = true

            // Percentage
            const percentage = Number(progressInfo.percent.toFixed(2))
            const fraction = Number((progressInfo.percent / 100).toFixed(2))

            // Filesize
            this.lastUpdateSize = progressInfo.total
            const transferredSize = progressInfo.transferred

            // Status
            logger.info('Application Update', 'Downloading:', `${percentage}% (${fraction})`, `${prettyBytes(transferredSize)}/${prettyBytes(this.lastUpdateSize)})`)

            // Set Progress Bar Percentage
            const mainWindow = getMainWindow()
            if (mainWindow) {
                mainWindow.setProgressBar(fraction)
            }
        })

        /**
         * @listens Electron.AutoUpdater:before-quit-for-update
         */
        autoUpdater.on('before-quit-for-update', () => {
            logger.debug('autoUpdater:before-quit-for-update')

            // Propagate event
            this.emit('before-quit-for-update')
            app.emit('before-quit-for-update')
        })

        /**
         * @listens Electron.AutoUpdater:update-downloaded
         */
        autoUpdater.on('update-downloaded', (/** Electron.AutoUpdater.updateInfo */ updateInfo) => {
            logger.debug('autoUpdater:update-downloaded')

            // Handle successful download
            this.onUpdateDownloaded(updateInfo)
        })
    }

    /**
     * Trigger updates based on application events
     * @private
     */
    registerEventTriggers() {
        logger.debug('registerEventTriggers')

        /**
         * Trigger immediately if application is ready
         */
        if (app.isReady()) {
            logger.debug('registerEventTriggers', 'app#isReady')

            this.requestUpdate()
        }


        /**
         * @listens Electron.App#activate
         */
        app.on('activate', () => {
            logger.debug('registerEventTriggers', 'app:activate')

            this.requestUpdate()
        })
    }

    /**
     * Trigger updates based on timers
     * @private
     */
    registerTimedTriggers() {
        logger.debug('registerTimedTriggers')

        if (this.requestIntervalHandler) { return }

        // Create interval for update requests
        this.requestIntervalHandler = setInterval(() => {
            logger.debug('registerTimedTriggers', updateRequestIntervalDuration, 'passed')

            this.requestUpdate()
        }, updateRequestIntervalDuration)
    }

    /**
     * Show report with stored Release Notes
     * @private
     */
    showReleaseNotes() {
        logger.debug('showReleaseNotes()')

        // Read appReleaseNotes
        const appReleaseNotes = retrieveAppReleaseNotes()

        // Show Dialog
        dialogProvider.showInformation(
            `Update installed successfully`,
            `${appProductName} has been updated to version ${appCurrentVersion}.` +
            `${os.EOL}${os.EOL}` +
            `${!!appReleaseNotes ? 'CHANGES:' + os.EOL + appReleaseNotes.toString() : ''}`, () => {
                // Focus
                app.focus()
            })
    }

    /**
     * Handle update since last launch
     * @private
     */
    checkRecentUpdate() {
        logger.debug('checkRecentUpdate()')

        // Read appLastVersion
        const appLastVersion = retrieveAppLastVersion()

        // If missing, initialize appLastVersion and abort
        if (!appLastVersion) {
            storeAppLastVersion(appCurrentVersion)

            return
        }

        // Compare appCurrentVersion vs. appLastVersion
        const applicationWasUpdated = Boolean(semverCompare(appCurrentVersion, appLastVersion) === 1)

        // Check if update happened
        if (applicationWasUpdated) {
            // Show report
            this.showReleaseNotes()

            // Increment appLastVersion
            storeAppLastVersion(appCurrentVersion)
        }
    }

    /**
     * Request Update
     * @private
     */
    requestUpdate() {
        logger.debug('requestUpdate()')

        if (!this.isEnabled) {
            logger.warn('Application Updates', 'Updates are disabled')
            return
        }

        if (this.isBusy) {
            logger.warn('Application Updates', 'Update service is busy')
            return
        }

        if (!autoUpdater) {
            logger.warn('Application Updates', 'Updater service is unavailable')
            return
        }

        // Status
        logger.info('Application Update', 'Requesting new update')

        // Query updates via AutoUpdater
        autoUpdater.checkForUpdates()
            .then((result) => {
                logger.debug('Application Updates', 'requestUpdate', 'result:', result)
            })
            .catch((error) => {
                logger.error('Application Updates', 'requestUpdate', error)
            })
    }

    /**
     * Quit application and install updates
     * @private
     */
    quitInstallUpdate() {
        /**
         * HOTFIX
         * Auto-Update quitAndInstall not working
         * @see {@link https://github.com/electron-userland/electron-builder/issues/3402}
         * @see {@link https://github.com/electron-userland/electron-builder/issues/1604}
         */
        // Remove blocking event listeners on app
        app.removeAllListeners('window-all-closed')

        // Remove blocking event listeners on all windows
        const browserWindowList = BrowserWindow.getAllWindows()
        browserWindowList.forEach((browserWindow) => {
            browserWindow.removeAllListeners('close')
        })

        // Status
        logger.info('Application Update', 'Restarting to install update')

        // Prepare installation
        setImmediate(() => {
            autoUpdater.quitAndInstall(false)
        })
    }

    /**
     * Handle download completion
     * @param {Object} updateInfo - Update Information
     * @public
     */
    onUpdateDownloaded(updateInfo = {}) {
        logger.debug('onUpdateDownloaded()')

        // Status
        logger.info('Application Update', 'Update download complete')

        // Focus app
        app.focus()

        // Block further updates
        this.isBusy = true

        // Store Release Notes
        if (!!updateInfo.releaseNotes) {
            storeAppReleaseNotes(removeMarkdown(updateInfo.releaseNotes))
        }

        // Show Notification: "Application Update ready"
        const notification = notificationProvider.create({
            title: 'Update download complete',
            body: `${appProductName} ${updateInfo.version} was downloaded successfully.`
        })

        /** @listens notification#show */
        notification.on('show', () => logger.debug('onUpdateDownloaded', 'notification:', notification))

        // Show Notification
        notification.show()

        // Bounce app icon (macOS)
        if (platformTools.isMacOS) {
            app.dock.bounce('informational')
        }

        // Show Dialog: "Are you sure you want to update?"
        dialogProvider.showConfirmation(`Are you sure you want to update?`,
            `Software update ${updateInfo.version} for ${appProductName} is ready.` +
            `${os.EOL}${os.EOL}` +
            `Install and restart now? All unsaved changes will be lost.`,
            (error, result) => {
                logger.debug('onUpdateDownloaded', 'error:', error, 'result:', result)

                // Handle Error
                if (error) {
                    logger.error('Application Updates', 'Error:', error)
                    return
                }

                // Handle Result
                if (result.response === 1) {
                    // Status
                    logger.info('Application Update', 'Preparing to install update')

                    // Quit and install
                    this.quitInstallUpdate()
                }
            })
    }
}


/**
 * Enable updates
 * @static
 * @public
 */
let enable = () => {
    logger.debug('enable')

    if (global.updaterService) {
        global.updaterService.isEnabled = true
    }
}

/**
 * Disable updates
 * @static
 * @public
 */
let disable = () => {
    logger.debug('disable')

    if (global.updaterService) {
        global.updaterService.isEnabled = false
    }
}

/**
 * Simulate application update download completion
 * @static
 * @public
 */
let simulate = () => {
    logger.debug('simulate')

    // Generate random update info
    const updateInfo = {
        releaseNotes: `${projectNameGenerator().spaced} Software Update\\n\\nRelease Notes`,
        version: semver.inc(appCurrentVersion, 'major')
    }

    global.updaterService.lastUpdateSize = randomInt(1000000, 1000000000)

    // Run onUpdateDownloaded event handler
    global.updaterService.onUpdateDownloaded(updateInfo)
}


/**
 * Init
 */
let init = () => {
    logger.debug('init')

    // Ensure single instance
    if (!global.updaterService) {
        global.updaterService = new UpdaterService()
    }
}

/**
 * @listens Electron.App:ready
 */
app.once('ready', () => {
    logger.debug('app:ready')

    init()
})


/**
 * @exports
 */
module.exports = global.updaterService


/**
 * @exports
 */
module.exports = {
    updaterService: global.updaterService,
    enable: enable,
    disable: disable,
    simulate: simulate
}
