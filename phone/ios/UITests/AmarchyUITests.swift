// The app in the simulator, against a real amarchy app server (server.py:
// this checkout's bin/amarchy, started by the workflow, its address in
// AMARCHY_TEST_SERVER): its own page with no address; an address typed
// there opening the machine's app with window.amarchyPhone in it and
// push.state answering through it; the app's links (amarchy://open,
// amarchy://chat, the app started by one); amarchy's own Tailscale node's
// sign-in, in a build that has it. What the page sees is read through the
// real bridge by the debug build's probe (-AmarchyProbe), into a label read
// here, with the app's last steps.

import XCTest

final class AmarchyUITests: XCTestCase {
    /// "http://127.0.0.1:<port>", the workflow's server (TEST_RUNNER_AMARCHY_TEST_SERVER).
    var server: String { ProcessInfo.processInfo.environment["AMARCHY_TEST_SERVER"] ?? "" }

    override func setUp() {
        continueAfterFailure = false
    }

    /// The app, started afresh; without its own Tailscale node unless asked
    /// (a build with it would show its sign-in, with no VPN in the simulator).
    private func launch(ownNode: Bool = false, forget: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AmarchyProbe"]
        if forget { app.launchArguments += ["-AmarchyForget"] }
        if !ownNode { app.launchArguments += ["-AmarchyNoOwnNode"] }
        app.launch()
        return app
    }

    /// The probe's JSON once it says `wanted`.
    @discardableResult
    private func probe(_ app: XCUIApplication, says wanted: String, within seconds: TimeInterval = 30,
                       file: StaticString = #filePath, line: UInt = #line) -> String {
        let label = app.staticTexts["probe"]
        let said = NSPredicate(format: "label CONTAINS %@", wanted)
        let wait = XCTNSPredicateExpectation(predicate: said, object: label)
        let result = XCTWaiter().wait(for: [wait], timeout: seconds)
        let text = label.exists ? label.label : "(no probe)"
        if result != .completed {
            shot(app, "failed")
            XCTFail("the page never said \(wanted); it says: \(text)", file: file, line: line)
        }
        return text
    }

    /// Text typed into the own page's address box, checked there (a fresh
    /// simulator's first keyboard can take its time to take keys).
    private func type(_ text: String, into app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let field = app.webViews.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20), "the address box", file: file, line: line)
        // What the box says lags what was typed: each try waits for it, so a
        // slow one isn't typed again on top of itself.
        let says = { (wanted: String, seconds: TimeInterval) -> Bool in
            let p = NSPredicate { box, _ in
                let v = ((box as? XCUIElement)?.value as? String) ?? ""
                let shown = v == field.placeholderValue ? "" : v
                return shown.lowercased() == wanted.lowercased()
            }
            return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: p, object: field)], timeout: seconds) == .completed
        }
        for _ in 0..<3 {
            field.tap()
            _ = app.keyboards.firstMatch.waitForExistence(timeout: 10)
            if let old = field.value as? String, !old.isEmpty, old != field.placeholderValue {
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: old.count))
                guard says("", 5) else { continue }
            }
            field.typeText(text)
            if says(text, 5) { return }
        }
        XCTFail("couldn't type \(text) into the address box: it has \(field.value ?? "nothing")", file: file, line: line)
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testItsOwnPageWithoutAnAddress() {
        let app = launch()
        let text = probe(app, says: #""title":"Can't find your amarchy""#)
        XCTAssertTrue(text.contains(#""shell":"object""#), "window.amarchyShell on its own page: \(text)")
        XCTAssertTrue(text.contains(#""phone":"undefined""#), "no window.amarchyPhone there: \(text)")
        XCTAssertTrue(app.staticTexts["Can't find your amarchy"].exists)
        XCTAssertTrue(app.webViews.textFields.firstMatch.exists, "the address box")
        XCTAssertTrue(app.webViews.buttons["Try again"].exists)
        shot(app, "1-own-page")

        // A wrong address says why, on the page, and it stays.
        type("http://elsewhere.example", into: app)
        app.webViews.buttons["Open"].tap()
        let why = app.staticTexts["Your amarchy's address starts with https:// (Tailscale gives it its certificate)"]
        XCTAssertTrue(why.waitForExistence(timeout: 10))
        sleep(3)
        XCTAssertTrue(why.exists, "the page's next status doesn't wipe it")
        shot(app, "2-own-page-wrong-address")
    }

    func testAnAddressTypedOpensTheMachine() throws {
        try XCTSkipIf(server.isEmpty, "no test server (AMARCHY_TEST_SERVER)")
        let app = launch()
        probe(app, says: #""title":"Can't find your amarchy""#)
        type(server, into: app)
        app.webViews.buttons["Open"].tap()

        // The machine's board, its chats on it.
        let text = probe(app, says: "Fix the login", within: 60)
        XCTAssertTrue(text.contains(#""bridge":true"#), "window.amarchyPhone on the machine's page: \(text)")
        XCTAssertTrue(text.contains(#""platform":"ios""#), text)
        XCTAssertTrue(text.contains(#""state":"unsupported""#), "push.state answers (no relay in this build): \(text)")
        XCTAssertTrue(text.contains("The app doesn't know no.such.command"), "an unknown command is refused in words: \(text)")
        XCTAssertTrue(text.contains("AmarchyApp/"), "the user agent says it's the app: \(text)")
        shot(app, "3-the-machine")
    }

    func testTheAppsLinks() throws {
        try XCTSkipIf(server.isEmpty, "no test server (AMARCHY_TEST_SERVER)")
        let app = launch()
        probe(app, says: #""title":"Can't find your amarchy""#)
        // The app started by its link (XCTest starts it again, with the
        // link, and the same arguments: without -AmarchyForget from now on,
        // so what it keeps is kept).
        app.launchArguments.removeAll { $0 == "-AmarchyForget" }
        app.open(try XCTUnwrap(URL(string: "amarchy://open?server=\(server)")))
        probe(app, says: "Fix the login", within: 60)
        shot(app, "4-opened-by-link")

        // A chat's link while it's open (as the system gives it, from
        // another app): told to the page, which goes to the chat.
        XCUIDevice.shared.system.open(try XCTUnwrap(URL(string: "amarchy://chat/testbox/desk-docs")))
        let confirm = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Open"]
        if confirm.waitForExistence(timeout: 4) { confirm.tap() }
        probe(app, says: ##""hash":"#/s/desk-docs""##, within: 45)
        shot(app, "5-a-chat-by-link")

        // A chat's link starting the app: the kept machine, on that chat.
        app.open(try XCTUnwrap(URL(string: "amarchy://chat/testbox/desk-fix")))
        probe(app, says: ##""hash":"#/s/desk-fix""##, within: 60)
        shot(app, "6-the-app-started-on-a-chat")

        // Kept: the next start opens the machine without asking.
        app.terminate()
        let again = launch(forget: false)
        probe(again, says: "Fix the login", within: 60)
    }

    func testItsOwnNodesSignIn() throws {
        let app = launch(ownNode: true)
        let text = probe(app, says: #""page":"own""#)
        try XCTSkipIf(text.contains(#""ownNode":false"#), "built without amarchy's own node (no Tailnet.xcframework)")
        // No VPN in the simulator: the node starts, and asks to be signed in.
        probe(app, says: #""status":"signin""#, within: 90)
        XCTAssertTrue(app.staticTexts["Sign in to Tailscale"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.buttons["Sign in to Tailscale"].exists)
        shot(app, "7-own-node-sign-in")
    }
}
