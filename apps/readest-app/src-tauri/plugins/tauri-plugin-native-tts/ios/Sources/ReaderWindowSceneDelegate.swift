import UIKit
import WebKit

/// Tao 0.34 creates the reader's window before UIKit connects its scene.
/// Keep that window/controller/web view (and its Rust ownership) intact.
public class ReaderWindowSceneDelegate: UIResponder, UIWindowSceneDelegate {
  public var window: UIWindow?
  private static weak var readerWindow: UIWindow?
  private static weak var readerWebView: WKWebView?
  private var windowObserver: NSObjectProtocol?
  weak var applicationDelegate: UIApplicationDelegate? = UIApplication.shared.delegate

  static func findReaderWindow(in windows: [UIWindow]) -> UIWindow? {
    if let window = readerWebView?.window { return window }
    func containsWebView(_ view: UIView) -> Bool {
      view is WKWebView || view.subviews.contains(where: containsWebView)
    }
    return windows.first {
      $0.rootViewController?.viewIfLoaded.map(containsWebView) == true
    }
  }

  static func register(webView: WKWebView) {
    readerWebView = webView
    sizeReaderWebView()
    // With scenes enabled, UIApplication.windows omits Tao's unattached
    // window. The plugin receives the actual reader web view after creation.
    // Either the web view or the scene may finish connecting first.
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene,
        let delegate = scene.delegate as? ReaderWindowSceneDelegate else { continue }
      delegate.attachReaderWindow(to: windowScene)
    }
  }

  private static func sizeReaderWebView() {
    guard let webView = readerWebView, let container = webView.superview else { return }
    // Wry's legacy flexible margins shrink/offset the web view when the
    // initially unattached window receives its scene's real dimensions.
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    webView.frame = container.bounds
  }

  public func scene(
    _ scene: UIScene, willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
      session.role == .windowApplication else { return }

    windowObserver = NotificationCenter.default.addObserver(
      forName: UIWindow.didBecomeVisibleNotification, object: nil, queue: .main
    ) { [weak self, weak windowScene] _ in
      guard let windowScene else { return }
      self?.attachReaderWindow(to: windowScene)
    }
    attachReaderWindow(to: windowScene)
    self.scene(scene, openURLContexts: connectionOptions.urlContexts)
    for activity in connectionOptions.userActivities {
      self.scene(scene, continue: activity)
    }
  }

  private func attachReaderWindow(to windowScene: UIWindowScene) {
    guard let reader = Self.readerWindow
      ?? Self.findReaderWindow(in: UIApplication.shared.windows) else { return }
    // Tauri owns one reader window. A second iPad window must not steal it
    // from the first scene; the independently managed CarPlay scene is fine.
    if let existingScene = reader.windowScene, existingScene !== windowScene {
      UIApplication.shared.requestSceneSessionDestruction(windowScene.session, options: nil)
      return
    }
    if let observer = windowObserver {
      NotificationCenter.default.removeObserver(observer)
      windowObserver = nil
    }
    Self.readerWindow = reader
    window = reader
    reader.windowScene = windowScene
    reader.frame = windowScene.coordinateSpace.bounds
    reader.makeKeyAndVisible()
    reader.layoutIfNeeded()
    Self.sizeReaderWebView()
  }

  public func sceneDidDisconnect(_ scene: UIScene) {
    if let observer = windowObserver { NotificationCenter.default.removeObserver(observer) }
    windowObserver = nil
    window?.windowScene = nil
    window = nil
  }

  public func sceneDidBecomeActive(_ scene: UIScene) {
    applicationDelegate?.applicationDidBecomeActive?(UIApplication.shared)
  }

  public func sceneWillResignActive(_ scene: UIScene) {
    applicationDelegate?.applicationWillResignActive?(UIApplication.shared)
  }

  public func sceneWillEnterForeground(_ scene: UIScene) {
    applicationDelegate?.applicationWillEnterForeground?(UIApplication.shared)
  }

  public func sceneDidEnterBackground(_ scene: UIScene) {
    applicationDelegate?.applicationDidEnterBackground?(UIApplication.shared)
  }

  public func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [
        .openInPlace: context.options.openInPlace
      ]
      if let source = context.options.sourceApplication { options[.sourceApplication] = source }
      if let annotation = context.options.annotation { options[.annotation] = annotation }
      _ = applicationDelegate?.application?(UIApplication.shared, open: context.url, options: options)
    }
  }

  public func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = applicationDelegate?.application?(
      UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
