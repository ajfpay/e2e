import UIKit
import XCTest

/// The manifest the server answers `initialize` with; the host half
/// declares the same at config load, and the client checks they agree.
enum Manifest {
  static let json: [String: Any] = [
    "name": "ios",
    "version": "0.1.0",
    "spiVersion": 1,
    "platform": "ios",
    "workers": 1,
    "methods": [
      "engine/observe", "engine/perform", "engine/performAt", "keyboard/type", "keyboard/press",
      "artifacts/screenshot", "session/back", "session/restart", "lifecycle/init",
      "lifecycle/startAttempt", "lifecycle/endAttempt",
    ],
    "actions": ["tap", "doubleTap", "longPress", "fill", "clear", "press", "check", "uncheck", "focus", "swipe"],
    "pointerActions": ["tap", "doubleTap", "longPress", "dragTo", "swipe", "swipeTo"],
  ]
}

/// The app under test as the engine contract sees it: one observation tree
/// read from an XCUITest snapshot, and input as XCUITest gestures at the
/// observed frames. Coordinates are points, the space frames come in.
final class Device {
  private static let roles: [XCUIElement.ElementType: String] = [
    .button: "button", .staticText: "text", .textField: "textbox", .secureTextField: "textbox",
    .searchField: "textbox", .textView: "textbox", .switch: "switch", .toggle: "switch", .image: "image",
    .icon: "image", .cell: "listitem", .table: "list", .collectionView: "list", .scrollView: "group",
    .navigationBar: "navigation", .tabBar: "tablist", .tab: "tab", .link: "link", .slider: "slider",
    .alert: "alert", .sheet: "dialog", .other: "group", .window: "group", .segmentedControl: "tablist",
    .picker: "combobox", .pickerWheel: "combobox", .stepper: "spinbutton", .webView: "document",
    .checkBox: "checkbox", .radioButton: "radio", .progressIndicator: "progressbar",
    .activityIndicator: "progressbar", .toolbar: "toolbar", .menu: "menu", .menuItem: "menuitem",
    .application: "application", .map: "image",
  ]

  private var app: XCUIApplication?
  private var bundleId: String?
  /// Each observed node's frame and kind, by id; ids carry the observation's generation.
  private var nodes: [String: (frame: CGRect, type: XCUIElement.ElementType, value: String?)] = [:]
  private var generation = 0

  func initialize(app declared: [String: Any]?, _ operation: Operation) throws {
    bundleId = declared?["bundleId"] as? String
    guard let bundleId else { return }
    let app = XCUIApplication(bundleIdentifier: bundleId)
    self.app = app
    try operation.check()
    if app.state != .runningForeground { app.activate() }
  }

  func startAttempt() {
    nodes = [:]
  }

  func environment() -> [String: String] {
    [
      "platform": "ios",
      "device": UIDevice.current.name,
      "os": "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)",
      "engine": "ios direct (XCUITest)",
    ]
  }

  private func requireApp() throws -> XCUIApplication {
    guard let app else { throw EngineFailure.unsupported("the ios engine needs the target's app.bundleId") }
    return app
  }

  // MARK: observation

  func observe(pixels: Bool) throws -> [String: Any] {
    let app = try requireApp()
    let snapshot = try app.snapshot()
    let viewport = snapshot.frame
    generation += 1
    var fresh: [String: (frame: CGRect, type: XCUIElement.ElementType, value: String?)] = [:]
    var counter = 0
    var keyboard = false
    var secureFrames: [CGRect] = []

    func convert(_ node: XCUIElementSnapshot) -> [String: Any]? {
      if node.elementType == .keyboard {
        keyboard = true
        return nil
      }
      counter += 1
      let id = "\(generation).\(counter)"
      let value = node.value.map { "\($0)" }
      fresh[id] = (node.frame, node.elementType, value)
      var out: [String: Any] = ["ref": ["id": id, "revision": ""]]
      let role = Device.roles[node.elementType] ?? "group"
      out["role"] = role
      let isSecure = node.elementType == .secureTextField
      if isSecure { secureFrames.append(node.frame) }
      let label = node.label.isEmpty ? nil : node.label
      if let label {
        out["name"] = String(label.prefix(256))
        out["text"] = String(label.prefix(512))
      }
      if role == "textbox", !isSecure, let value, !value.isEmpty, value != node.placeholderValue {
        out["value"] = value
      }
      if !node.identifier.isEmpty { out["testId"] = node.identifier }
      if isSecure { out["inputPurpose"] = "password" }
      var states: [String: Bool] = [:]
      if !node.isEnabled { states["disabled"] = true }
      if node.isSelected { states["selected"] = true }
      if role == "switch" || role == "checkbox", value == "1" { states["checked"] = true }
      if isSecure { states["secure"] = true }
      if hasKeyboardFocus(node) { states["focused"] = true }
      // Off the screen is hidden, as a person sees it: scrolling brings it in.
      if node.frame.isEmpty || !node.frame.intersects(viewport) { states["hidden"] = true }
      if !states.isEmpty { out["states"] = states }
      out["rect"] = ["x": node.frame.minX, "y": node.frame.minY, "width": node.frame.width, "height": node.frame.height]
      if let placeholder = node.placeholderValue, !placeholder.isEmpty { out["attributes"] = ["placeholder": placeholder] }
      let children = node.children.compactMap(convert)
      if !children.isEmpty { out["children"] = children }
      return out
    }

    let tree = node(snapshot.children.compactMap(convert))
    nodes = fresh
    let size = snapshot.frame.size
    var result: [String: Any] = [
      "root": tree.merging(["rect": ["x": 0, "y": 0, "width": size.width, "height": size.height]]) { $1 },
      "viewport": ["width": size.width, "height": size.height],
      "keyboardVisible": keyboard,
      "location": bundleId ?? "",
    ]
    if pixels {
      let capture = XCUIScreen.main.screenshot().image
      // A field that appeared or moved during the capture is masked too.
      for frame in try self.secureFrames() where !secureFrames.contains(frame) { secureFrames.append(frame) }
      let image = masked(capture, secureFrames)
      if let data = image.pngData() {
        result["pixels"] = [
          "data": data.base64EncodedString(), "mediaType": "image/png",
          "width": Int(image.size.width * image.scale), "height": Int(image.size.height * image.scale),
          "scale": Double(image.scale),
        ]
        result["maskedRegionCount"] = secureFrames.count
      }
    }
    return result
  }

  private func node(_ children: [[String: Any]]) -> [String: Any] {
    ["ref": ["id": "root", "revision": ""], "role": "screen", "children": children]
  }

  // MARK: actions

  func perform(_ id: String, _ action: [String: Any], _ operation: Operation) throws {
    try operation.check()
    let app = try requireApp()
    let kind = action["kind"] as? String ?? ""
    if id == "root" {
      guard kind == "swipe" else { throw EngineFailure.unsupported("the screen root only takes a swipe") }
      try swipe(in: app.frame, direction: action["direction"] as? String ?? "down", momentum: action["momentum"] as? String, app)
      return
    }
    guard let node = nodes[id] else { throw EngineFailure.stale(id) }
    let center = try actionable(node.frame, id, app)
    switch kind {
    case "tap", "focus":
      coordinate(center, app).tap()
    case "doubleTap":
      coordinate(center, app).doubleTap()
    case "longPress":
      coordinate(center, app).press(forDuration: (action["durationMs"] as? Double ?? 800) / 1000)
    case "check", "uncheck":
      let checked = node.value == "1"
      if checked != (kind == "check") { coordinate(center, app).tap() }
    case "fill", "clear":
      guard node.type == .textField || node.type == .secureTextField || node.type == .searchField || node.type == .textView else {
        throw EngineFailure.notActionable("node \(id) does not take text")
      }
      coordinate(center, app).tap()
      if node.type == .secureTextField {
        // iOS empties a secure field on the first keystroke after it takes
        // focus, so typing replaces it; a clear types one character and
        // deletes it.
        app.typeText(kind == "fill" ? action["value"] as? String ?? "" : "x" + XCUIKeyboardKey.delete.rawValue)
        return
      }
      let existing = node.value?.count ?? 0
      if existing > 0 { app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing)) }
      if kind == "fill" { app.typeText(action["value"] as? String ?? "") }
    case "press":
      if node.type == .textField || node.type == .secureTextField || node.type == .textView { coordinate(center, app).tap() }
      try press(action["key"] as? String ?? "", operation)
    case "swipe":
      try swipe(in: node.frame, direction: action["direction"] as? String ?? "down", momentum: action["momentum"] as? String, app)
    default:
      throw EngineFailure.unsupported("the \"\(kind)\" action is not supported")
    }
  }

  func performAt(_ point: CGPoint, _ action: [String: Any], _ operation: Operation) throws {
    try operation.check()
    let app = try requireApp()
    let at = coordinate(point, app)
    switch action["kind"] as? String ?? "" {
    case "tap": at.tap()
    case "doubleTap": at.doubleTap()
    case "longPress": at.press(forDuration: (action["durationMs"] as? Double ?? 800) / 1000)
    case "dragTo", "swipeTo":
      let target = action["target"] as? [String: Any] ?? [:]
      let end = coordinate(CGPoint(x: target["x"] as? Double ?? 0, y: target["y"] as? Double ?? 0), app)
      let hold = action["kind"] as? String == "dragTo" ? 0.6 : 0.05
      at.press(forDuration: hold, thenDragTo: end)
    case "swipe":
      let size = app.frame.size
      let half = min(size.width, size.height) / 4
      try swipe(in: CGRect(x: point.x - half, y: point.y - half, width: half * 2, height: half * 2), direction: action["direction"] as? String ?? "down", momentum: action["momentum"] as? String, app)
    default:
      throw EngineFailure.unsupported("the \"\(action["kind"] ?? "")\" action at a point is not supported")
    }
  }

  func type(_ text: String, replace: Bool, _ operation: Operation) throws {
    try operation.check()
    let app = try requireApp()
    if replace {
      let focused = app.descendants(matching: .any).element(matching: NSPredicate(format: "hasKeyboardFocus == true"))
      guard focused.exists else { throw EngineFailure.notActionable("nothing that takes text has focus") }
      if focused.elementType == .secureTextField {
        app.typeText("x" + XCUIKeyboardKey.delete.rawValue)
      } else if let value = focused.value as? String, !value.isEmpty, value != focused.placeholderValue {
        app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
      }
    }
    app.typeText(text)
  }

  func press(_ key: String, _ operation: Operation) throws {
    try operation.check()
    let app = try requireApp()
    if key.count > 1, key.contains("+") {
      let modifier = key.split(separator: "+").first.map(String.init) ?? key
      throw EngineFailure.unsupported("the soft keyboard cannot hold \(modifier) (\(key))")
    }
    switch key {
    case "Enter": app.typeText("\n")
    case "Tab": app.typeText("\t")
    case "Backspace": app.typeText(XCUIKeyboardKey.delete.rawValue)
    case "Space": app.typeText(" ")
    default:
      guard key.count == 1 else { throw EngineFailure.unsupported("the soft keyboard cannot press \(key)") }
      app.typeText(key)
    }
  }

  /// Back is the edge swipe a person makes: from the left edge across the screen.
  func back(_ operation: Operation) throws {
    try operation.check()
    let app = try requireApp()
    let size = app.frame.size
    let from = coordinate(CGPoint(x: 2, y: size.height / 2), app)
    from.press(forDuration: 0.05, thenDragTo: coordinate(CGPoint(x: size.width * 0.75, y: size.height / 2), app))
  }

  func restart(_ operation: Operation) throws {
    try operation.check()
    let app = try requireApp()
    app.terminate()
    app.activate()
  }

  /// A screenshot with every secure field painted over: found from a fresh
  /// snapshot before and after the capture, so a field that appeared or
  /// moved meanwhile is masked too.
  func screenshotBase64() throws -> String {
    let before = try secureFrames()
    let image = XCUIScreen.main.screenshot().image
    let after = try secureFrames()
    guard let data = masked(image, before + after.filter { !before.contains($0) }).pngData() else {
      throw EngineFailure.invalidState("the screen could not be captured")
    }
    return data.base64EncodedString()
  }

  // MARK: helpers

  /// The frames of every secure field in a fresh snapshot of the app.
  private func secureFrames() throws -> [CGRect] {
    guard let app else { return [] }
    var frames: [CGRect] = []
    func walk(_ node: XCUIElementSnapshot) {
      if node.elementType == .secureTextField { frames.append(node.frame) }
      node.children.forEach(walk)
    }
    walk(try app.snapshot())
    return frames
  }

  /// Whether a field holds the keyboard: XCTest's snapshot knows, behind a
  /// property it does not publish, so it is read only where it exists.
  private func hasKeyboardFocus(_ node: XCUIElementSnapshot) -> Bool {
    guard let object = node as? NSObject, object.responds(to: NSSelectorFromString("hasKeyboardFocus")) else { return false }
    return object.value(forKey: "hasKeyboardFocus") as? Bool ?? false
  }

  private func coordinate(_ point: CGPoint, _ app: XCUIApplication) -> XCUICoordinate {
    app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y))
  }

  private func actionable(_ frame: CGRect, _ id: String, _ app: XCUIApplication) throws -> CGPoint {
    let visible = frame.intersection(app.frame)
    guard !visible.isNull, !visible.isEmpty else { throw EngineFailure.notActionable("node \(id) is off screen") }
    return CGPoint(x: visible.midX, y: visible.midY)
  }

  /// A scroll gesture inside `frame`: `down` reveals what is below, so the finger travels up.
  private func swipe(in frame: CGRect, direction: String, momentum: String?, _ app: XCUIApplication) throws {
    let dx = frame.width * 0.3
    let dy = frame.height * 0.3
    let center = CGPoint(x: frame.midX, y: frame.midY)
    let (from, to): (CGPoint, CGPoint)
    switch direction {
    case "down": (from, to) = (CGPoint(x: center.x, y: center.y + dy), CGPoint(x: center.x, y: center.y - dy))
    case "up": (from, to) = (CGPoint(x: center.x, y: center.y - dy), CGPoint(x: center.x, y: center.y + dy))
    case "right": (from, to) = (CGPoint(x: center.x + dx, y: center.y), CGPoint(x: center.x - dx, y: center.y))
    case "left": (from, to) = (CGPoint(x: center.x - dx, y: center.y), CGPoint(x: center.x + dx, y: center.y))
    default: throw EngineFailure.unsupported("unknown swipe direction \(direction)")
    }
    let velocity: XCUIGestureVelocity = momentum == "fast" ? .fast : (momentum == "none" ? .slow : .default)
    coordinate(from, app).press(forDuration: 0.05, thenDragTo: coordinate(to, app), withVelocity: velocity, thenHoldForDuration: momentum == "none" ? 0.1 : 0)
  }

  /// Paints secure fields over a capture, so no password leaves the device.
  private func masked(_ image: UIImage, _ frames: [CGRect]) -> UIImage {
    guard !frames.isEmpty else { return image }
    let format = UIGraphicsImageRendererFormat()
    format.scale = image.scale
    return UIGraphicsImageRenderer(size: image.size, format: format).image { context in
      image.draw(at: .zero)
      UIColor.black.setFill()
      for frame in frames { context.fill(frame) }
    }
  }
}
