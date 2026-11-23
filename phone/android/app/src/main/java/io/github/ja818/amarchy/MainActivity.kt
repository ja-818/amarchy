package io.github.ja818.amarchy

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.CookieManager
import android.webkit.HttpAuthHandler
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.ColorUtils
import androidx.core.graphics.toColorInt
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.ScriptHandler
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.File
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * The app: one web view on your machine's amarchy (`app/`, never a second
 * UI), or on its own page (desktop/dist) while it isn't showing amarchy.
 * What it adds is only what a page can't do on a phone (phone/README.md).
 */
class MainActivity : ComponentActivity() {
    /** Something to open in the page: a route, a card to show, or "something was shared". */
    private data class Open(val go: String? = null, val ask: String? = null, val share: Boolean = false) {
        fun after(older: Open?) = Open(go ?: older?.go, ask ?: older?.ask, share || older?.share == true)

        fun detail(): JsonObject = buildJsonObject {
            go?.let { put("go", it) }
            ask?.let { put("ask", it) }
            if (share) put("share", true)
        }
    }

    private lateinit var kept: Kept
    private lateinit var root: FrameLayout
    private var web: WebView? = null
    private val assets by lazy { WebViewAssetLoader.Builder().addPathHandler("/shell/", ShellAssets(this)).build() }

    private var target: String? = null          // the machine opened (its origin), or being opened
    private var machine = ""                     // its name, for a chat's link
    private var status = ShellStatus.opening     // what the own page shows
    private var reaching: Job? = null
    private var signingIn: Job? = null
    private var sharing: Job? = null
    private var waitingOpen: Open? = null        // for the machine's page, once it's up
    private var pageReady = false
    private var clearHistoryOn: String? = null   // the origin whose next page starts the history afresh
    private var phoneOrigin: String? = null
    private var phoneScript: ScriptHandler? = null
    private var fileChosen: ValueCallback<Array<Uri>>? = null
    private var micAsked: PermissionRequest? = null
    private var notifyAsked: CompletableDeferred<Boolean>? = null

    // Back: the page's history first (a chat back to the board), then out of the app.
    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            web?.takeIf { it.canGoBack() }?.goBack()
        }
    }

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileChosen?.onReceiveValue(chosen(r.resultCode, r.data))
        fileChosen = null
    }

    private val askMic = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        val request = micAsked ?: return@registerForActivityResult
        micAsked = null
        if (ok) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request.deny()
            toast("Amarchy can't hear you: allow the microphone for it in Android's settings")
        }
    }

    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        notifyAsked?.complete(ok)
        notifyAsked = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        kept = Kept(this)
        machine = kept.machine
        if (!webViewWorks()) return tooOld()
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        root = FrameLayout(this)
        setContentView(root)
        // Edge to edge: the page sits between the system's bars and above the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        bars(getColor(R.color.bg))
        onBackPressedDispatcher.addCallback(this, back)
        newWeb()
        // A share or a link opened it: that, once. From the recents (or after the
        // system ended it), the same intent comes again: then only the app.
        val again = savedInstanceState != null || intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0
        if (again || !take(intent)) reach(kept.server)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (web != null) take(intent)
    }

    override fun onRestart() {
        super.onRestart()
        if (web == null) return
        // Back from turning the VPN on, say: try again by itself.
        if (!onMachine() && reaching?.isActive != true && status.kind in setOf(ShellStatus.Kind.Failed, ShellStatus.Kind.Nothing)) {
            reach(target ?: kept.server)
        } else {
            sendShares()
        }
    }

    override fun onDestroy() {
        micAsked?.deny()
        micAsked = null
        fileChosen?.onReceiveValue(null)
        fileChosen = null
        notifyAsked?.complete(false)
        web?.destroy()
        web = null
        super.onDestroy()
    }

    // ---- what opened it

    /** Takes what an intent asks for: whether it opened something itself. */
    private fun take(intent: Intent?): Boolean {
        when (intent?.action) {
            Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE -> share(intent)
            Intent.ACTION_VIEW -> when (val link = Link.parse(intent.dataString)) {
                null -> toast("That isn't an Amarchy link")
                else -> {
                    follow(link)
                    return true
                }
            }
            Notes.ACTION_OPEN -> {
                val server = intent.getStringExtra(Notes.EXTRA_SERVER)?.let { Address.parse(it).getOrNull() }
                val open = Open(go = intent.getStringExtra(Notes.EXTRA_GO), ask = intent.getStringExtra(Notes.EXTRA_ASK))
                if (server != null && server != target) reach(server, open) else open(open)
                return true
            }
        }
        return false
    }

    private fun follow(link: Link) {
        when (link) {
            is Link.Chat -> open(Open(go = link.route(machine)))
            is Link.Open -> {
                val now = kept.server
                if (now == null || now == link.server) return reach(link.server)
                // A link may come from anywhere: another machine only when you say so.
                if (target == null) reach(now)
                AlertDialog.Builder(this, android.R.style.Theme_Material_Dialog_Alert)
                    .setTitle("Open another amarchy?")
                    .setMessage("This link opens ${Address.host(link.server)} instead of ${Address.host(now)}.")
                    .setPositiveButton("Open it") { _, _ -> reach(link.server) }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
    }

    /** Opens something in the machine's page: told, when it's up; else loaded once it is. */
    private fun open(open: Open) {
        val origin = target
        val w = web
        if (origin != null && w != null && onMachine() && pageReady) {
            w.evaluateJavascript(BridgeScripts.open(origin, open.detail())) { told ->
                if (told != "true" && (open.go != null || open.ask != null || open.share)) w.loadUrl(Routes.page(origin, open.go, open.ask))
            }
            return
        }
        waitingOpen = open.after(waitingOpen)
        if (!onMachine() && reaching?.isActive != true) reach(origin ?: kept.server)
    }

    // ---- reaching the machine

    private fun onMachine() = target != null && Address.origin(web?.url) == target

    /** Opens the machine at origin (null: none known yet): its hello first, then its app, or the own page says why not. */
    private fun reach(origin: String?, then: Open? = null) {
        if (then != null) waitingOpen = then.after(waitingOpen)
        reaching?.cancel()
        target = origin
        status = ShellStatus.opening.copy(label = origin?.let(Address::host))
        showOwnPage()
        reaching = lifecycleScope.launch {
            if (!throughOwnNode()) return@launch
            val at: String = origin ?: run {
                val found = find()
                status = when {
                    found == null -> Words.noAddress(vpnOn())
                    found.isEmpty() -> Words.noneFound()
                    found.size > 1 -> ShellStatus(ShellStatus.Kind.Choose, machines = found)
                    else -> return@run found.single().url.also { target = it }
                }
                return@launch
            }
            val said = try {
                withContext(Dispatchers.IO) { hello(at) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                status = Words.unreached(at, e, vpnOn(), OwnNode.proxy != null)
                return@launch
            }
            kept.keep(at, said)
            machine = said.name
            load(at)
        }
    }

    private fun hello(origin: String): Hello {
        val answer = Http.get("$origin/api/peer/hello", 5_000)
        return Hello.parse(answer.code, answer.body).getOrThrow()
    }

    /** Its app, in the web view: the bridge for its origin first. */
    private fun load(origin: String) {
        val w = web ?: return
        phoneBridge(w, origin)
        val open = waitingOpen
        waitingOpen = null
        clearHistoryOn = origin
        pageReady = false
        w.loadUrl(Routes.page(origin, open?.go, open?.ask))
        lifecycleScope.launch { Push.catchUp(applicationContext) }
        sendShares()
    }

    private fun showOwnPage() {
        val w = web ?: return
        if (w.url?.startsWith(OWN_PAGE) == true) return       // it's there, and polls its status
        pageReady = false
        clearHistoryOn = ASSET_ORIGIN
        bars(getColor(R.color.bg))
        w.loadUrl(OWN_PAGE)
    }

    private fun vpnOn(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return false
        return cm.getNetworkCapabilities(cm.activeNetwork)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
    }

    // ---- amarchy's own node (when the build has it, and the VPN is off)

    /** Whether to go on: the own node isn't needed, or it's on the tailnet; else the own page says why. */
    private suspend fun throughOwnNode(): Boolean {
        if (!OwnNode.available || vpnOn()) return true
        val started = withContext(Dispatchers.IO) { OwnNode.start(File(filesDir, "tailnet"), nodeName()) }
        started.exceptionOrNull()?.let {
            status = ShellStatus(ShellStatus.Kind.Failed, label = OWN_NODE, why = it.message)
            return false
        }
        var last: NodeState? = null
        repeat(30) {
            val state = withContext(Dispatchers.IO) { OwnNode.state() }
            last = state ?: last
            when {
                state?.running == true -> {
                    proxyWebView()
                    return true
                }
                state?.needsLogin == true -> {
                    status = ShellStatus(ShellStatus.Kind.SignIn, why = state.words.ifEmpty { null })
                    return false
                }
            }
            delay(500)
        }
        status = ShellStatus(ShellStatus.Kind.Failed, label = OWN_NODE, why = "It didn't get on the tailnet: ${last?.words?.ifEmpty { null } ?: "no word from it"}")
        return false
    }

    /** Your machines on the tailnet that answer as amarchy (the own node's peers); null when it can't look. */
    private suspend fun find(): List<Candidate>? {
        val node = withContext(Dispatchers.IO) { OwnNode.state() }?.takeIf { it.running && OwnNode.proxy != null } ?: return null
        return withContext(Dispatchers.IO) {
            node.peers.filter { it.online }.map { p ->
                async {
                    val url = "https://${p.dns}"
                    runCatching { hello(url) }.getOrNull()?.let { Candidate(it.name, it.label, url) }
                }
            }.awaitAll().filterNotNull()
        }
    }

    /** The web view reaches the tailnet (only) through the own node's proxy. */
    private fun proxyWebView() {
        val p = OwnNode.proxy ?: return
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) return
        val config = ProxyConfig.Builder().addProxyRule("${p.host}:${p.port}")
        if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE_REVERSE_BYPASS)) {
            config.addBypassRule("*.ts.net").addBypassRule("100.64.0.0/10").setReverseBypassEnabled(true)
        }
        ProxyController.getInstance().setProxyOverride(config.build(), ContextCompat.getMainExecutor(this)) {}
    }

    private fun signIn(call: BridgeCall, reply: JavaScriptReplyProxy) {
        if (!OwnNode.available) {
            reply.answer(call.error("This app reaches your tailnet through the Tailscale app: turn on its VPN, then Try again."))
            return
        }
        lifecycleScope.launch {
            val url = withContext(Dispatchers.IO) { OwnNode.loginUrl() }
            url.onFailure { reply.answer(call.error(it.message ?: "Tailscale's sign-in page didn't come")) }
            val page = url.getOrNull() ?: return@launch
            reply.answer(call.result(null))
            browse(page)
            status = ShellStatus(ShellStatus.Kind.SignIn, why = status.why, waiting = true)
            signingIn?.cancel()
            signingIn = launch {
                repeat(300) {           // ten minutes
                    delay(2_000)
                    if (withContext(Dispatchers.IO) { OwnNode.state() }?.running == true) {
                        reach(target ?: kept.server)
                        return@launch
                    }
                }
            }
        }
    }

    private fun nodeName() =
        "amarchy-" + Build.MODEL.orEmpty().lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifEmpty { "android" }.take(40)

    // ---- the web view

    private fun webViewWorks(): Boolean = try {
        bridges()
    } catch (e: RuntimeException) {
        false       // no WebView on the phone at all (it's being updated, or turned off)
    }

    /** What both bridges are made of (a WebView from 2020 on has them). */
    private fun bridges() = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    private fun tooOld() {
        val words = TextView(this).apply {
            setText(R.string.old_webview)
            setTextColor(getColor(R.color.text))
            textSize = 17f
            gravity = Gravity.CENTER
            setPadding(64, 64, 64, 64)
            setOnClickListener { browse("https://play.google.com/store/apps/details?id=com.google.android.webview") }
        }
        setContentView(words)
    }

    // JavaScript is what the own page and amarchy's app are.
    @SuppressLint("SetJavaScriptEnabled")
    private fun newWeb() {
        val w = WebView(this)
        w.setBackgroundColor(getColor(R.color.bg))
        with(w.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false        // the app's chimes
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(true)                  // every new window goes to the system (onCreateWindow)
            javaScriptCanOpenWindowsAutomatically = true
            setGeolocationEnabled(false)
            userAgentString += AppInfo.userAgent
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(w.settings, false)       // the app wears its own themes
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(w, false)
        w.webViewClient = client
        w.webChromeClient = chrome
        w.setDownloadListener { url, _, _, _, _ -> route(url, emptySet()) }
        // (onCreate checked both features: a phone without them never gets here.)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(w, BridgeScripts.SHELL_PORT, setOf(ASSET_ORIGIN)) { _, message, origin, main, reply ->
                if (main && origin.toString() == ASSET_ORIGIN) BridgeCall.parse(message.data)?.let { shellCall(it, reply) }
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, BridgeScripts.shell(), setOf(ASSET_ORIGIN))
        }
        phoneOrigin = null
        phoneScript = null
        root.addView(w, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        web = w
    }

    /** `window.amarchyPhone`, on the machine's origin only (set again when the address changes). */
    private fun phoneBridge(w: WebView, origin: String) {
        if (phoneOrigin == origin) return
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            if (phoneOrigin != null) WebViewCompat.removeWebMessageListener(w, BridgeScripts.PHONE_PORT)
            WebViewCompat.addWebMessageListener(w, BridgeScripts.PHONE_PORT, setOf(origin)) { _, message, from, main, reply ->
                if (main && from.toString() == target) BridgeCall.parse(message.data)?.let { phoneCall(it, reply) }
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            phoneScript?.remove()
            phoneScript = WebViewCompat.addDocumentStartJavaScript(w, BridgeScripts.phone(AppInfo.version, Push.relay), setOf(origin))
        }
        phoneOrigin = origin
    }

    private val client = object : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
            assets.shouldInterceptRequest(request.url)

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame && request.url.scheme in setOf("http", "https", "about", "data", "blob")) return false
            return route(request.url.toString(), setOfNotNull(target, ASSET_ORIGIN))
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            pageReady = false
            if (Address.origin(url) != target) bars(getColor(R.color.bg))
        }

        override fun onPageFinished(view: WebView, url: String) {
            val origin = Address.origin(url)
            if (origin != null && origin == clearHistoryOn) {
                view.clearHistory()
                clearHistoryOn = null
            }
            back.isEnabled = view.canGoBack()
            if (origin != null && origin == target) {
                pageReady = true
                waitingOpen?.let {
                    waitingOpen = null
                    open(it)
                }
            }
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            back.isEnabled = view.canGoBack()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame || error.description?.contains("ERR_ABORTED") == true) return
            val origin = Address.origin(request.url.toString()) ?: return
            if (origin == target) {
                status = Words.dropped(origin, error.description?.toString())
                showOwnPage()
            }
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            val origin = Address.origin(error.url) ?: return
            if (origin == target && !pageReady) {
                status = Words.badCertificate(origin)
                showOwnPage()
            }
        }

        // The own node's proxy asks for its credentials: only it gets them.
        override fun onReceivedHttpAuthRequest(view: WebView, handler: HttpAuthHandler, host: String, realm: String?) {
            val p = OwnNode.proxy
            if (p != null && host.substringBefore(':') == p.host) handler.proceed(p.user, p.password) else handler.cancel()
        }

        // Its page's process died (out of memory, say): a new web view, and the machine again.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            root.removeView(view)
            view.destroy()
            if (web === view) web = null
            newWeb()
            reach(target ?: kept.server)
            return true
        }
    }

    private val chrome = object : WebChromeClient() {
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileChosen?.onReceiveValue(null)
            fileChosen = callback
            val pick = params.createIntent().apply {
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            }
            return try {
                pickFiles.launch(pick)
                true
            } catch (e: ActivityNotFoundException) {
                fileChosen = null
                toast("No app on this phone picks files")
                false
            }
        }

        // The microphone, for the app's dictation: only for the machine's page.
        override fun onPermissionRequest(request: PermissionRequest) {
            val fromMachine = Address.origin(request.origin.toString()) == target
            if (!fromMachine || PermissionRequest.RESOURCE_AUDIO_CAPTURE !in request.resources) {
                request.deny()
                return
            }
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                micAsked?.deny()
                micAsked = request
                askMic.launch(Manifest.permission.RECORD_AUDIO)
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (micAsked === request) micAsked = null
        }

        // target=_blank and window.open: never a page in the app, always the system's.
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            val popup = WebView(this@MainActivity)
            var taken = false
            fun take(url: String) {
                if (taken) return
                taken = true
                route(url, emptySet())
                popup.post { popup.destroy() }
            }
            popup.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean {
                    take(request.url.toString())
                    return true
                }

                override fun onPageStarted(v: WebView, url: String, favicon: Bitmap?) {
                    if (url == "about:blank") return
                    v.stopLoading()
                    take(url)
                }

                override fun onRenderProcessGone(v: WebView, detail: RenderProcessGoneDetail): Boolean {
                    taken = true
                    v.destroy()
                    return true
                }
            }
            // One that never goes anywhere (written into by its opener) is let go.
            popup.postDelayed({
                if (!taken) {
                    taken = true
                    popup.destroy()
                }
            }, 10_000)
            (resultMsg.obj as? WebView.WebViewTransport)?.webView = popup
            resultMsg.sendToTarget()
            return true
        }
    }

    /** Where a navigation goes; true when it isn't the web view's to load. */
    private fun route(url: String, origins: Set<String>): Boolean = when (val nav = WebLinks.decide(url, origins)) {
        Nav.Here -> false
        is Nav.Browser -> true.also { browse(nav.url) }
        is Nav.System -> true.also { system(nav) }
        is Nav.Ours -> true.also { follow(nav.link) }
        is Nav.Refused -> true.also { if (nav.scheme !in setOf("about", "javascript")) toast("Amarchy doesn't open ${nav.scheme.ifEmpty { "those" }}: links") }
    }

    private fun browse(url: String) {
        val colors = CustomTabColorSchemeParams.Builder().setToolbarColor(getColor(R.color.bg)).build()
        try {
            CustomTabsIntent.Builder().setShowTitle(true).setDefaultColorSchemeParams(colors).build().launchUrl(this, url.toUri())
        } catch (e: ActivityNotFoundException) {
            toast("No browser on this phone opens links")
        }
    }

    /** tel:, mailto:, intent:, another app's scheme: the system's to open, as a browser would. */
    private fun system(nav: Nav.System) {
        val intent = if (nav.scheme == "intent") {
            runCatching { Intent.parseUri(nav.url, Intent.URI_INTENT_SCHEME) }.getOrNull()?.apply {
                // As Chrome does: only what a link may open, never this app's own insides or files.
                addCategory(Intent.CATEGORY_BROWSABLE)
                component = null
                selector = null
                flags = flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION).inv()
            }
        } else {
            Intent(Intent.ACTION_VIEW, nav.url.toUri()).addCategory(Intent.CATEGORY_BROWSABLE)
        }
        if (intent == null) return toast("That link isn't one this phone can open")
        try {
            startActivity(intent)
        } catch (e: ActivityNotFoundException) {
            val fallback = intent.getStringExtra("browser_fallback_url")?.takeIf { it.startsWith("https://") || it.startsWith("http://") }
            if (fallback != null) browse(fallback) else toast("No app on this phone opens ${nav.scheme}: links")
        }
    }

    private fun chosen(code: Int, data: Intent?): Array<Uri>? {
        if (code != RESULT_OK || data == null) return null
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) return Array(clip.itemCount) { clip.getItemAt(it).uri }
        return data.data?.let { arrayOf(it) }
    }

    /** The system's bars wear the page's color (the theme's), with icons that show on it. */
    private fun bars(color: Int) {
        if (!::root.isInitialized) return
        root.setBackgroundColor(color)
        val light = ColorUtils.calculateLuminance(color) > 0.5
        WindowCompat.getInsetsController(window, root).run {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    // ---- the own page's commands (window.amarchyShell.invoke)

    private fun shellCall(call: BridgeCall, reply: JavaScriptReplyProxy) {
        when (call.command) {
            "status" -> reply.answer(call.result(status.toJson()))
            "choose" -> {
                val m = status.machines.find { it.name == call.args.string("name") }
                if (m == null) {
                    reply.answer(call.error("That one isn't on the list any more"))
                } else {
                    reply.answer(call.result(null))
                    reach(m.url)
                }
            }
            "use_address" -> Address.parse(call.args.string("address").orEmpty()).fold(
                onSuccess = {
                    reply.answer(call.result(null))
                    reach(it)
                },
                onFailure = { reply.answer(call.error(it.message ?: "That isn't an address")) },
            )
            "retry" -> {
                reply.answer(call.result(null))
                reach(target ?: kept.server)
            }
            "sign_in" -> signIn(call, reply)
            else -> reply.answer(call.error("The app doesn't know \"${call.command}\""))
        }
    }

    // ---- the machine's page's commands (window.amarchyPhone.call)

    private fun phoneCall(call: BridgeCall, reply: JavaScriptReplyProxy) {
        val server = target ?: return
        lifecycleScope.launch {
            val answer = try {
                call.result(phoneAnswer(server, call))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Said) {
                call.error(e.message.orEmpty())
            } catch (e: Exception) {
                call.error("It didn't work: ${e.message ?: e.javaClass.simpleName}")
            }
            if (call.id != 0L) reply.answer(answer)
        }
    }

    private suspend fun phoneAnswer(server: String, call: BridgeCall): JsonElement? = when (call.command) {
        "push.state" -> JsonPrimitive(Push.state(this, server, permission()))
        "push.subscribe" -> {
            val key = call.args.string("key") ?: throw Said("Which machine's push key (key)?")
            if (!Push.usable(this)) {
                throw Said(if (Push.built) "This phone has no Google Play services, which Android's notifications come through" else Push.UNSUPPORTED)
            }
            if (!allowNotifications()) throw Said("Notifications are off for Amarchy: turn them on in Android's settings")
            Push.subscribe(applicationContext, server, key)
        }
        "push.unsubscribe" -> Push.unsubscribe(applicationContext, server)?.let { buildJsonObject { put("endpoint", it) } }
        "notes.clear" -> {
            val tags = (call.args["tags"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            Notes.clear(this, tags)
            null
        }
        "status" -> {
            Widget.status(this, Board.parse(call.args))
            null
        }
        "shell.bars" -> {
            call.args.string("color")?.let(::parseColor)?.let(::bars)
            null
        }
        else -> throw Said("The app doesn't know \"${call.command}\"")
    }

    private fun permission(): Push.Permission = when {
        NotificationManagerCompat.from(this).areNotificationsEnabled() -> Push.Permission.Allowed
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED &&
            (!kept.notificationsAsked || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) -> Push.Permission.Ask
        else -> Push.Permission.Blocked
    }

    /** The system's yes, asked for while it's still your tap. */
    private suspend fun allowNotifications(): Boolean = when (permission()) {
        Push.Permission.Allowed -> true
        Push.Permission.Blocked -> false
        Push.Permission.Ask -> Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && run {
            kept.notificationsAsked = true
            val answer = CompletableDeferred<Boolean>()
            notifyAsked?.complete(false)
            notifyAsked = answer
            askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
            answer.await() && NotificationManagerCompat.from(this).areNotificationsEnabled()
        }
    }

    // ---- the share sheet

    private fun share(intent: Intent) {
        lifecycleScope.launch {
            val kept = withContext(Dispatchers.IO) {
                try {
                    ShareInbox.keep(applicationContext, intent)
                } catch (e: IOException) {
                    null
                }
            }
            when (kept) {
                null -> toast("Couldn't keep what you shared: is the phone's storage full?")
                false -> toast("There's nothing in that to share")
                true -> sendShares()
            }
        }
    }

    /** What's in the inbox goes to the machine (when its page is up), then the page shows "Send it to a chat". */
    private fun sendShares() {
        val origin = target ?: return
        if (!onMachine() || sharing?.isActive == true) return
        sharing = lifecycleScope.launch {
            val app = applicationContext
            val sent = withContext(Dispatchers.IO) { if (ShareInbox.waiting(app)) ShareInbox.send(app, origin) else null } ?: return@launch
            sent.refused.forEach { toast("Couldn't share that: $it") }
            if (sent.kept > 0) toast("Kept what you shared: it goes to ${kept.label.ifEmpty { Address.host(origin) }} once it answers")
            if (sent.sent > 0) open(Open(share = true))
            if (sent.kept == 0 && withContext(Dispatchers.IO) { ShareInbox.waiting(app) }) {
                sharing = null
                sendShares()        // more came while these went
            }
        }
    }

    private fun toast(words: String) = Toast.makeText(this, words, Toast.LENGTH_LONG).show()

    // (onCreate checked the feature: a phone without it never gets a bridge.)
    private fun JavaScriptReplyProxy.answer(json: String) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) postMessage(json)
    }

    private class ShellAssets(context: Context) : WebViewAssetLoader.PathHandler {
        private val assets = WebViewAssetLoader.AssetsPathHandler(context)

        override fun handle(path: String): WebResourceResponse? = assets.handle("shell/$path")
    }

    private companion object {
        const val ASSET_ORIGIN = "https://appassets.androidplatform.net"
        const val OWN_PAGE = "$ASSET_ORIGIN/shell/index.html"
        const val OWN_NODE = "amarchy's own Tailscale node"

        // A theme's color: #rgb, #rrggbb, #aarrggbb, or rgb(r, g, b).
        fun parseColor(text: String): Int? {
            val t = text.trim()
            Regex("""rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+).*\)""").matchEntire(t)?.let { m ->
                val (r, g, b) = m.destructured
                return Color.rgb(r.toInt().coerceIn(0, 255), g.toInt().coerceIn(0, 255), b.toInt().coerceIn(0, 255))
            }
            val hex = if (Regex("#[0-9a-fA-F]{3}").matches(t)) "#" + t.drop(1).map { "$it$it" }.joinToString("") else t
            return runCatching { hex.toColorInt() }.getOrNull()
        }
    }
}
