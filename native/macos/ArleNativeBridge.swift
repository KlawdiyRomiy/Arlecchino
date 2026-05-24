import AppKit
import Foundation
import ObjectiveC
import Security
import UserNotifications

public typealias ArleNativeCallback = @convention(c) (
    UnsafePointer<CChar>?,
    UnsafePointer<CChar>?
) -> Void

private var nativeCallback: ArleNativeCallback?
private let nativeQueue = DispatchQueue(label: "io.arlecchino.native.bridge")

private final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let content = response.notification.request.content
        var payload: [String: Any] = [
            "id": response.notification.request.identifier,
            "actionIdentifier": response.actionIdentifier
        ]
        if !content.userInfo.isEmpty {
            payload["userInfo"] = content.userInfo
        }
        emitNativeCallback("notification.response", payload)
        completionHandler()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(macOS 11.0, *) {
            completionHandler([.banner, .sound, .list])
        } else {
            completionHandler([.alert, .sound])
        }
    }
}

private final class MenuCoordinator: NSObject, NSMenuDelegate {
    static let shared = MenuCoordinator()

    private var commandEnabledByTitle: [String: Bool] = [:]
    private var recentProjects: [[String: String]] = []

    func configure() {
        DispatchQueue.main.async {
            guard let mainMenu = NSApp.mainMenu else { return }
            self.attachDelegates(menu: mainMenu)
            self.applyState()
        }
    }

    func updateState(payload: [String: Any]) {
        DispatchQueue.main.async {
            if let commands = payload["commands"] as? [[String: Any]] {
                var next: [String: Bool] = [:]
                for command in commands {
                    guard let title = command["title"] as? String else { continue }
                    next[title] = (command["enabled"] as? Bool) ?? false
                }
                self.commandEnabledByTitle = next
            }
            if let recent = payload["recentProjects"] as? [[String: Any]] {
                self.recentProjects = recent.compactMap { item in
                    guard
                        let title = item["title"] as? String,
                        let path = item["path"] as? String
                    else {
                        return nil
                    }
                    return ["title": title, "path": path]
                }
            }
            self.configure()
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        applyState()
    }

    func patchFullscreenShortcut(payload: [String: Any]) {
        DispatchQueue.main.async {
            guard
                let submenuTitle = payload["submenu"] as? String,
                let itemTitle = payload["item"] as? String,
                let submenuItem = NSApp.mainMenu?.item(withTitle: submenuTitle),
                let submenu = submenuItem.submenu
            else {
                return
            }
            guard let item = self.preferredMenuItem(title: itemTitle, in: submenu) else {
                return
            }
            if let key = payload["key"] as? String, !key.isEmpty {
                item.keyEquivalent = key.lowercased()
                item.keyEquivalentModifierMask = [.function]
            } else {
                item.keyEquivalent = ""
                item.keyEquivalentModifierMask = []
            }
            self.deduplicateMenuItem(title: itemTitle, preferred: item, in: submenu)
        }
    }

    @objc func openRecentProject(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        emitNativeCallback("menu.openRecent", ["projectPath": path])
    }

    private func attachDelegates(menu: NSMenu) {
        menu.delegate = self
        for item in menu.items {
            if let submenu = item.submenu {
                attachDelegates(menu: submenu)
            }
        }
    }

    private func applyState() {
        guard let mainMenu = NSApp.mainMenu else { return }
        updateStandardEditValidation(menu: mainMenu)
        updateCustomCommandValidation(menu: mainMenu)
        updateOpenRecent(menu: mainMenu)
    }

    private func updateStandardEditValidation(menu: NSMenu) {
        let selectors: [String: Selector] = [
            "Cut": #selector(NSText.cut(_:)),
            "Copy": #selector(NSText.copy(_:)),
            "Paste": #selector(NSText.paste(_:)),
            "Select All": #selector(NSText.selectAll(_:))
        ]
        for (title, selector) in selectors {
            guard let item = findItem(title: title, in: menu) else { continue }
            item.isEnabled = NSApp.target(forAction: selector, to: nil, from: item) != nil
        }
    }

    private func updateCustomCommandValidation(menu: NSMenu) {
        for (title, enabled) in commandEnabledByTitle {
            guard let item = findItem(title: title, in: menu) else { continue }
            item.isEnabled = enabled
        }
    }

    private func updateOpenRecent(menu: NSMenu) {
        guard let openRecent = findItem(title: "Open Recent", in: menu) else { return }
        let submenu = openRecent.submenu ?? NSMenu(title: "Open Recent")
        openRecent.submenu = submenu
        submenu.delegate = self
        submenu.removeAllItems()

        if recentProjects.isEmpty {
            let empty = NSMenuItem(title: "No Recent Projects", action: nil, keyEquivalent: "")
            empty.isEnabled = false
            submenu.addItem(empty)
            return
        }

        for project in recentProjects {
            guard let title = project["title"], let path = project["path"] else { continue }
            let item = NSMenuItem(title: title, action: #selector(openRecentProject(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = path
            submenu.addItem(item)
        }
    }

    private func findItem(title: String, in menu: NSMenu) -> NSMenuItem? {
        for item in menu.items {
            if item.title == title {
                return item
            }
            if let submenu = item.submenu, let found = findItem(title: title, in: submenu) {
                return found
            }
        }
        return nil
    }

    private func preferredMenuItem(title: String, in menu: NSMenu) -> NSMenuItem? {
        var firstMatch: NSMenuItem?
        var wailsMatch: NSMenuItem?
        for item in menu.items where item.title == title {
            if firstMatch == nil {
                firstMatch = item
            }
            if wailsMatch == nil, let action = item.action, NSStringFromSelector(action) == "handleClick" {
                wailsMatch = item
            }
        }
        return wailsMatch ?? firstMatch
    }

    private func deduplicateMenuItem(title: String, preferred: NSMenuItem, in menu: NSMenu) {
        for index in stride(from: menu.items.count - 1, through: 0, by: -1) {
            let item = menu.items[index]
            if item !== preferred && item.title == title {
                menu.removeItem(at: index)
            }
        }
    }
}

private var originalButtonsSuperviewFrameKey: UInt8 = 0
private var originalButtonsSuperviewKey: UInt8 = 0

@_cdecl("ArleNativeSetCallback")
public func ArleNativeSetCallback(_ callback: ArleNativeCallback?) {
    nativeQueue.sync {
        nativeCallback = callback
    }
}

@_cdecl("ArleNativeCall")
public func ArleNativeCall(
    _ operationPointer: UnsafePointer<CChar>?,
    _ jsonPointer: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>? {
    let operation = operationPointer.map { String(cString: $0) } ?? ""
    let payload = parseJSON(jsonPointer)

    switch operation {
    case "ping":
        return nativeResult(["ok": true, "bridge": "swift"])
    case "app.hide":
        DispatchQueue.main.async { NSApp.hide(nil) }
        return nativeResult(["ok": true])
    case "app.show":
        DispatchQueue.main.async {
            NSApp.unhide(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        return nativeResult(["ok": true])
    case "attention.request":
        let critical = (payload["critical"] as? Bool) ?? false
        DispatchQueue.main.async {
            _ = NSApp.requestUserAttention(critical ? .criticalRequest : .informationalRequest)
        }
        return nativeResult(["ok": true])
    case "dock.setBadge":
        let label = (payload["label"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        DispatchQueue.main.async {
            NSApp.dockTile.badgeLabel = label.isEmpty ? nil : label
            NSApp.dockTile.display()
        }
        return nativeResult(["ok": true])
    case "notification.send":
        return sendNotification(payload)
    case "credential.find":
        return findCredential(payload)
    case "credential.save":
        return saveCredential(payload)
    case "credential.delete":
        return deleteCredential(payload)
    case "menu.configure":
        MenuCoordinator.shared.configure()
        return nativeResult(["ok": true])
    case "menu.updateState":
        MenuCoordinator.shared.updateState(payload: payload)
        return nativeResult(["ok": true])
    case "menu.patchFullscreenShortcut":
        MenuCoordinator.shared.patchFullscreenShortcut(payload: payload)
        return nativeResult(["ok": true])
    default:
        return nativeError("unsupported operation: \(operation)")
    }
}

@_cdecl("ArleNativeFree")
public func ArleNativeFree(_ pointer: UnsafeMutablePointer<CChar>?) {
    if let pointer {
        free(pointer)
    }
}

@_cdecl("ArleNativeToggleFullscreen")
public func ArleNativeToggleFullscreen() {
    DispatchQueue.main.async {
        guard let window = controlsWindow(nil) else { return }
        prepareNativeFullscreen(window)
        window.toggleFullScreen(nil)
    }
}

@_cdecl("ArleNativeIsFullscreen")
public func ArleNativeIsFullscreen() -> Bool {
    var result = false
    syncMain {
        guard let window = controlsWindow(nil) else { return }
        result = window.styleMask.contains(.fullScreen)
    }
    return result
}

@_cdecl("ArleNativePositionWindowControls")
public func ArleNativePositionWindowControls(
    _ preferredWindow: UnsafeMutableRawPointer?,
    _ closeX: Double,
    _ closeY: Double,
    _ minimiseX: Double,
    _ minimiseY: Double,
    _ maximiseX: Double,
    _ maximiseY: Double
) -> Bool {
    var didPosition = false
    syncMain {
        didPosition = positionNativeWindowControlsOnMainThread(
            preferredWindow,
            closeX,
            closeY,
            minimiseX,
            minimiseY,
            maximiseX,
            maximiseY
        )
    }
    return didPosition
}

private func parseJSON(_ pointer: UnsafePointer<CChar>?) -> [String: Any] {
    guard let pointer else { return [:] }
    let text = String(cString: pointer)
    guard
        let data = text.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data),
        let dictionary = object as? [String: Any]
    else {
        return [:]
    }
    return dictionary
}

private func nativeResult(_ payload: [String: Any]) -> UnsafeMutablePointer<CChar>? {
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
    let text = String(data: data, encoding: .utf8) ?? "{}"
    return strdup(text)
}

private func nativeError(_ message: String) -> UnsafeMutablePointer<CChar>? {
    nativeResult(["ok": false, "error": message])
}

private func emitNativeCallback(_ event: String, _ payload: [String: Any]) {
    let callback = nativeQueue.sync { nativeCallback }
    guard let callback else { return }
    let data = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
    let text = String(data: data, encoding: .utf8) ?? "{}"
    event.withCString { eventPointer in
        text.withCString { payloadPointer in
            callback(eventPointer, payloadPointer)
        }
    }
}

private func syncMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
        block()
    } else {
        DispatchQueue.main.sync(execute: block)
    }
}

private func sendNotification(_ payload: [String: Any]) -> UnsafeMutablePointer<CChar>? {
    let id = (payload["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let title = (payload["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let body = (payload["body"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard let id, !id.isEmpty, let title, !title.isEmpty else {
        return nativeError("notification id and title are required")
    }

    let center = UNUserNotificationCenter.current()
    center.delegate = NotificationDelegate.shared
    center.getNotificationSettings { settings in
        let send: () -> Void = {
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            if let userInfo = payload["data"] as? [String: Any] {
                content.userInfo = userInfo
            }
            let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
            center.add(request) { error in
                if let error {
                    emitNativeCallback("notification.error", ["id": id, "error": error.localizedDescription])
                }
            }
        }

        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            send()
        case .notDetermined:
            center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
                if let error {
                    emitNativeCallback("notification.error", ["id": id, "error": error.localizedDescription])
                    return
                }
                if granted {
                    send()
                } else {
                    emitNativeCallback("notification.denied", ["id": id])
                }
            }
        default:
            emitNativeCallback("notification.denied", ["id": id])
        }
    }

    return nativeResult(["ok": true])
}

private func findCredential(_ payload: [String: Any]) -> UnsafeMutablePointer<CChar>? {
    guard let service = credentialString(payload["service"]), let account = credentialString(payload["account"]) else {
        return nativeError("credential service and account are required")
    }
    var query = credentialQuery(service: service, account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound {
        return nativeResult(["ok": false, "notFound": true])
    }
    guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
        return nativeError("Keychain lookup failed: OSStatus \(status)")
    }
    return nativeResult(["ok": true, "value": value])
}

private func saveCredential(_ payload: [String: Any]) -> UnsafeMutablePointer<CChar>? {
    guard
        let service = credentialString(payload["service"]),
        let account = credentialString(payload["account"]),
        let value = credentialString(payload["value"])
    else {
        return nativeError("credential service, account, and value are required")
    }
    let data = Data(value.utf8)
    let query = credentialQuery(service: service, account: account)
    let updateStatus = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if updateStatus == errSecSuccess {
        return nativeResult(["ok": true])
    }
    if updateStatus != errSecItemNotFound {
        return nativeError("Keychain update failed: OSStatus \(updateStatus)")
    }

    var addQuery = query
    addQuery[kSecValueData as String] = data
    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
        return nativeError("Keychain save failed: OSStatus \(addStatus)")
    }
    return nativeResult(["ok": true])
}

private func deleteCredential(_ payload: [String: Any]) -> UnsafeMutablePointer<CChar>? {
    guard let service = credentialString(payload["service"]), let account = credentialString(payload["account"]) else {
        return nativeError("credential service and account are required")
    }
    let status = SecItemDelete(credentialQuery(service: service, account: account) as CFDictionary)
    if status == errSecSuccess || status == errSecItemNotFound {
        return nativeResult(["ok": true])
    }
    return nativeError("Keychain delete failed: OSStatus \(status)")
}

private func credentialString(_ value: Any?) -> String? {
    guard let text = value as? String else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func credentialQuery(service: String, account: String) -> [String: Any] {
    [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account
    ]
}

private func controlsWindow(_ preferredWindow: UnsafeMutableRawPointer?) -> NSWindow? {
    if let preferredWindow {
        return Unmanaged<NSWindow>.fromOpaque(preferredWindow).takeUnretainedValue()
    }
    if let keyWindow = NSApp.keyWindow {
        return keyWindow
    }
    if let mainWindow = NSApp.mainWindow {
        return mainWindow
    }
    if let visible = NSApp.windows.first(where: { $0.isVisible }) {
        return visible
    }
    return NSApp.windows.first
}

private func buttonCenterX(_ button: NSButton) -> CGFloat {
    button.frame.origin.x + button.frame.size.width / 2.0
}

private func buttonCenterY(_ button: NSButton) -> CGFloat {
    button.frame.origin.y + button.frame.size.height / 2.0
}

private func windowButtonsSuperview(_ close: NSButton?, _ minimise: NSButton?, _ maximise: NSButton?) -> NSView? {
    guard
        let close,
        let minimise,
        let maximise,
        let superview = close.superview,
        superview == minimise.superview,
        superview == maximise.superview
    else {
        return nil
    }
    return superview
}

private func refreshNativeControlView(_ view: NSView?, window: NSWindow?) {
    guard let view else { return }
    view.needsDisplay = true
    view.updateTrackingAreas()
    if let window {
        window.invalidateCursorRects(for: view)
    }
}

private func refreshWindowButton(_ button: NSButton?) {
    guard let button else { return }
    button.needsDisplay = true
    button.updateTrackingAreas()
}

private func refreshWindowButtons(_ close: NSButton?, _ minimise: NSButton?, _ maximise: NSButton?) {
    guard let buttonSuperview = windowButtonsSuperview(close, minimise, maximise) else { return }
    refreshWindowButton(close)
    refreshWindowButton(minimise)
    refreshWindowButton(maximise)

    let window = buttonSuperview.window
    refreshNativeControlView(close, window: window)
    refreshNativeControlView(minimise, window: window)
    refreshNativeControlView(maximise, window: window)

    var view: NSView? = buttonSuperview
    while let current = view {
        refreshNativeControlView(current, window: window)
        view = current.superview
    }
}

private func rememberButtonsSuperviewFrame(_ buttonSuperview: NSView?) {
    guard let buttonSuperview else { return }
    if objc_getAssociatedObject(buttonSuperview, &originalButtonsSuperviewFrameKey) == nil {
        objc_setAssociatedObject(
            buttonSuperview,
            &originalButtonsSuperviewFrameKey,
            NSValue(rect: buttonSuperview.frame),
            .OBJC_ASSOCIATION_RETAIN_NONATOMIC
        )
    }
    if objc_getAssociatedObject(buttonSuperview, &originalButtonsSuperviewKey) == nil, let superview = buttonSuperview.superview {
        objc_setAssociatedObject(
            buttonSuperview,
            &originalButtonsSuperviewKey,
            NSValue(nonretainedObject: superview),
            .OBJC_ASSOCIATION_RETAIN_NONATOMIC
        )
    }
}

private func originalButtonsSuperview(_ buttonSuperview: NSView) -> NSView? {
    guard
        let value = objc_getAssociatedObject(buttonSuperview, &originalButtonsSuperviewKey) as? NSValue,
        let view = value.nonretainedObjectValue as? NSView
    else {
        return nil
    }
    return view
}

private func attachButtonsSuperview(_ buttonSuperview: NSView?, to parentView: NSView?) -> Bool {
    guard let buttonSuperview, let parentView else { return false }

    let retainedSuperview = Unmanaged.passRetained(buttonSuperview)
    buttonSuperview.removeFromSuperviewWithoutNeedingDisplay()
    parentView.addSubview(buttonSuperview, positioned: .above, relativeTo: nil)
    retainedSuperview.release()

    buttonSuperview.isHidden = false
    buttonSuperview.needsDisplay = true
    buttonSuperview.updateTrackingAreas()
    parentView.needsDisplay = true
    parentView.updateTrackingAreas()
    if let window = parentView.window {
        window.invalidateCursorRects(for: buttonSuperview)
        window.recalculateKeyViewLoop()
    }
    return true
}

private func raiseButtonsSuperview(_ buttonSuperview: NSView?) -> Bool {
    attachButtonsSuperview(buttonSuperview, to: buttonSuperview?.superview)
}

private func moveButtonsSuperviewToContentView(_ buttonSuperview: NSView?, window: NSWindow?) -> Bool {
    attachButtonsSuperview(buttonSuperview, to: window?.contentView)
}

private func restoreButtonsSuperview(_ close: NSButton?, _ minimise: NSButton?, _ maximise: NSButton?) -> Bool {
    guard let buttonSuperview = windowButtonsSuperview(close, minimise, maximise) else { return false }
    if let originalSuperview = originalButtonsSuperview(buttonSuperview), buttonSuperview.superview !== originalSuperview {
        _ = attachButtonsSuperview(buttonSuperview, to: originalSuperview)
    }
    if let originalFrame = objc_getAssociatedObject(buttonSuperview, &originalButtonsSuperviewFrameKey) as? NSValue {
        buttonSuperview.frame = originalFrame.rectValue
    }
    _ = raiseButtonsSuperview(buttonSuperview)
    refreshWindowButtons(close, minimise, maximise)
    return true
}

private func moveButtonsSuperview(
    _ close: NSButton?,
    _ minimise: NSButton?,
    _ maximise: NSButton?,
    closeX: CGFloat,
    closeY: CGFloat,
    minimiseY: CGFloat,
    maximiseY: CGFloat
) -> Bool {
    guard
        let close,
        let minimise,
        let maximise,
        let buttonSuperview = windowButtonsSuperview(close, minimise, maximise)
    else {
        return false
    }

    rememberButtonsSuperviewFrame(buttonSuperview)
    let window = buttonSuperview.window
    if !moveButtonsSuperviewToContentView(buttonSuperview, window: window) {
        _ = raiseButtonsSuperview(buttonSuperview)
    }
    guard let parentView = buttonSuperview.superview else { return false }

    let parentBounds = parentView.bounds
    var superviewFrame = buttonSuperview.frame
    let desiredCenterY = (closeY + minimiseY + maximiseY) / 3.0
    let currentCenterY = (buttonCenterY(close) + buttonCenterY(minimise) + buttonCenterY(maximise)) / 3.0
    superviewFrame.origin.y = parentBounds.size.height - desiredCenterY - currentCenterY
    superviewFrame.origin.x = closeX - buttonCenterX(close)
    buttonSuperview.frame = superviewFrame
    refreshWindowButtons(close, minimise, maximise)
    return true
}

private func positionNativeWindowControlsOnMainThread(
    _ preferredWindow: UnsafeMutableRawPointer?,
    _ closeX: Double,
    _ closeY: Double,
    _ minimiseX: Double,
    _ minimiseY: Double,
    _ maximiseX: Double,
    _ maximiseY: Double
) -> Bool {
    guard let window = controlsWindow(preferredWindow) else { return false }
    let close = window.standardWindowButton(.closeButton)
    let minimise = window.standardWindowButton(.miniaturizeButton)
    let maximise = window.standardWindowButton(.zoomButton)

    if window.styleMask.contains(.fullScreen) {
        return restoreButtonsSuperview(close, minimise, maximise)
    }

    return moveButtonsSuperview(
        close,
        minimise,
        maximise,
        closeX: CGFloat(closeX),
        closeY: CGFloat(closeY),
        minimiseY: CGFloat(minimiseY),
        maximiseY: CGFloat(maximiseY)
    )
}

private func prepareNativeFullscreen(_ window: NSWindow) {
    var behavior = window.collectionBehavior
    behavior.insert(.fullScreenPrimary)
    behavior.remove(.fullScreenAuxiliary)
    window.collectionBehavior = behavior
}
