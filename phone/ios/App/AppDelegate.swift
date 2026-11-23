// The app's lifecycle: notifications' delegate set before launch ends (iOS
// starts the app in the background for a button, and hands it over at
// once), the APNs token, one window with the shell, and the links it's
// opened with.

import UIKit
import UserNotifications

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        #if DEBUG
        TestHooks.atLaunch()
        #endif
        UNUserNotificationCenter.current().delegate = NotificationHandler.shared
        PushService.shared.launch()
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting session: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default", sessionRole: session.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushService.shared.didRegister(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushService.shared.didFail(error)
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let shell = ShellViewController()
        let window = UIWindow(windowScene: windowScene)
        window.backgroundColor = .amarchyBackground
        window.rootViewController = shell
        window.makeKeyAndVisible()
        self.window = window
        // Its page and its connection set up before a link it was opened with.
        shell.loadViewIfNeeded()
        Router.shared.shell = shell
        trace("scene, \(options.urlContexts.count) link(s)")
        options.urlContexts.forEach { open($0.url) }
    }

    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        contexts.forEach { open($0.url) }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        Router.shared.shell?.becameActive()
    }

    private func open(_ url: URL) {
        trace("open \(url.absoluteString)")
        guard let link = AmarchyLink(url) else { return }
        Router.shared.with { $0.handle(link) }
    }
}

/// The shell, for what arrives before its window does (a notification
/// tapped at launch): kept until it's there.
@MainActor
final class Router {
    static let shared = Router()
    private var queued: [@MainActor (ShellViewController) -> Void] = []

    weak var shell: ShellViewController? {
        didSet {
            guard let shell else { return }
            let waiting = queued
            queued = []
            waiting.forEach { $0(shell) }
        }
    }

    func with(_ act: @escaping @MainActor (ShellViewController) -> Void) {
        if let shell { act(shell) } else { queued.append(act) }
    }
}
