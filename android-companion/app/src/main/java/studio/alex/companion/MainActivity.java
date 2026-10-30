package studio.alex.companion;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String APP_URL = "http://127.0.0.1:3000";
    private WebView webView;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String host = request.getUrl().getHost();
                return host == null || !(host.equals("127.0.0.1") || host.equals("localhost"));
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
            }
            @Override public void onReceivedError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) showConnectionHelp();
            }
        });
        setContentView(webView);
        if (state == null) webView.loadUrl(APP_URL); else webView.restoreState(state);
    }

    private void showConnectionHelp() {
        String html = "<html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='font:16px system-ui;padding:28px;background:#101827;color:#eef'><h2>Alex Studio</h2><p>تعذّر الاتصال بخادم Alex Studio على الكمبيوتر.</p><p>1. شغّل Alex Studio على الكمبيوتر على المنفذ 3000.</p><p>2. وصّل الهاتف بالكمبيوتر عبر USB وفعّل USB debugging.</p><p>3. نفّذ الأمر: <b>adb reverse tcp:3000 tcp:3000</b></p><p>4. اضغط إعادة المحاولة.</p><button onclick='location.href=\"http://127.0.0.1:3000\"'>إعادة المحاولة</button></body></html>";
        webView.loadDataWithBaseURL("http://127.0.0.1/", html, "text/html", "UTF-8", null);
    }

    @Override protected void onSaveInstanceState(Bundle outState) { webView.saveState(outState); super.onSaveInstanceState(outState); }
    @Override public void onBackPressed() { if (webView != null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy() { if (webView != null) webView.destroy(); super.onDestroy(); }
}
