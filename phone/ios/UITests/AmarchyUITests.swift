// The app in the simulator, against a real amarchy app server (server.py:
// this checkout's bin/amarchy, started by the workflow, its address in
// AMARCHY_TEST_SERVER): its own page with no address; an address typed
// there opening the machine's app with window.amarchyPhone in it and
// push.state answering through it; the app's links (amarchy://open,
// amarchy://chat). What the page sees is read through the real bridge by
// the debug build's probe (-AmarchyProbe), into a label read here.

import XCTest

final class AmarchyUITests: XCTestCase {
    /// "http://127.0.0.1:<port>", the workflow's server (TEST_RUNNER_AMARCHY_TEST_SERVER).
    var server: String { ProcessInfo.processInfo.environment["AMARCHY_TEST_SERVER"] ?? "" }

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments += ["-AmarchyForget", "-AmarchyProbe"]
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
            shot(app, "failed-\(name)")
            XCTFail("the page never said \(wanted); it says: \(text)", file: file, line: line)
        }
        return text
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testItsOwnPageWithoutAnAddress() {
        let app = launch()
        let text = probe(app, says: #""page":"own""#)
        XCTAssertTrue(text.contains(#""shell":"object""#), "window.amarchyShell on its own page: \(text)")
        XCTAssertTrue(text.contains(#""phone":"undefined""#), "no window.amarchyPhone there: \(text)")
        XCTAssertTrue(app.staticTexts["Can't find your amarchy"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.webViews.textFields.firstMatch.exists, "the address box")
        XCTAssertTrue(app.webViews.buttons["Try again"].exists)
        shot(app, "1-own-page")

        // A wrong address says why, on the page.
        let field = app.webViews.textFields.firstMatch
        field.tap()
        field.typeText("http://elsewhere.example")
        app.webViews.buttons["Open"].tap()
        XCTAssertTrue(app.staticTexts["Your amarchy's address starts with https:// (Tailscale gives it its certificate)"]
            .waitForExistence(timeout: 10))
        shot(app, "2-own-page-wrong-address")
    }

    func testAnAddressTypedOpensTheMachine() throws {
        try XCTSkipIf(server.isEmpty, "no test server (AMARCHY_TEST_SERVER)")
        let app = launch()
        let field = app.webViews.textFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 20))
        field.tap()
        field.typeText(server)
        app.webViews.buttons["Open"].tap()

        let text = probe(app, says: #""bridge":true"#, within: 60)
        XCTAssertTrue(text.contains(#""platform":"ios""#), text)
        XCTAssertTrue(text.contains(#""state":"unsupported""#), "push.state answers (no relay in this build): \(text)")
        XCTAssertTrue(text.contains("The app doesn't know no.such.command"), "an unknown command is refused in words: \(text)")
        XCTAssertTrue(text.contains("AmarchyApp/"), "the user agent says it's the app: \(text)")
        XCTAssertTrue(text.contains("Fix the login") || text.contains("Write the docs"), "the machine's chats on the page: \(text)")
        shot(app, "3-the-machine")
    }

    func testTheAppsLinks() throws {
        try XCTSkipIf(server.isEmpty, "no test server (AMARCHY_TEST_SERVER)")
        let app = launch()
        probe(app, says: #""page":"own""#)
        app.open(try XCTUnwrap(URL(string: "amarchy://open?server=\(server)")))
        probe(app, says: #""bridge":true"#, within: 60)
        shot(app, "4-opened-by-link")

        // A chat's link: told to the page, which goes to the chat.
        app.open(try XCTUnwrap(URL(string: "amarchy://chat/testbox/desk-fix")))
        probe(app, says: ##""hash":"#/s/desk-fix""##)
        shot(app, "5-a-chat-by-link")

        // Kept: the next start opens the machine without asking.
        app.terminate()
        let again = XCUIApplication()
        again.launchArguments += ["-AmarchyProbe"]
        again.launch()
        probe(again, says: #""bridge":true"#, within: 60)
    }
}
