package studio.alex.companion;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.ByteArrayInputStream;

public final class MainActivity extends Activity {
    private static final String APP_URL = "http://127.0.0.1:3000";
    private static final int INK = Color.rgb(18, 25, 38);
    private static final int MUTED = Color.rgb(105, 116, 133);
    private static final int ACCENT = Color.rgb(91, 111, 245);

    private WebView webView;
    private ProgressBar progress;
    private LinearLayout connectionPanel;
    private TextView statusText;
    private boolean showingConnectionError;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(248, 250, 253));
        getWindow().setNavigationBarColor(Color.rgb(248, 250, 253));
        if (Build.VERSION.SDK_INT >= 26) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        } else if (Build.VERSION.SDK_INT >= 23) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }
        buildShell();
        configureWebView();
        if (state == null || webView.restoreState(state) == null) connect();
    }

    private void buildShell() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(Color.WHITE);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(20), dp(14), dp(20), dp(14));
        header.setBackgroundColor(Color.WHITE);

        TextView mark = new TextView(this);
        mark.setText("A");
        mark.setTextColor(Color.WHITE);
        mark.setTextSize(18);
        mark.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        mark.setGravity(Gravity.CENTER);
        mark.setBackground(roundRect(ACCENT, 14));
        header.addView(mark, new LinearLayout.LayoutParams(dp(42), dp(42)));

        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        brand.setPadding(dp(12), 0, 0, 0);
        TextView title = new TextView(this);
        title.setText("Alex Studio");
        title.setTextColor(INK);
        title.setTextSize(17);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        TextView subtitle = new TextView(this);
        subtitle.setText("AI development workspace");
        subtitle.setTextColor(MUTED);
        subtitle.setTextSize(11);
        brand.addView(title);
        brand.addView(subtitle);
        header.addView(brand, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        statusText = new TextView(this);
        statusText.setText("غير متصل");
        statusText.setTextColor(MUTED);
        statusText.setTextSize(12);
        header.addView(statusText);
        shell.addView(header);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setVisibility(View.GONE);
        shell.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));

        FrameLayout content = new FrameLayout(this);
        shell.addView(content, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        webView = new WebView(this);
        content.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        connectionPanel = new LinearLayout(this);
        connectionPanel.setOrientation(LinearLayout.VERTICAL);
        connectionPanel.setGravity(Gravity.CENTER);
        connectionPanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        connectionPanel.setBackgroundColor(Color.rgb(248, 250, 253));

        TextView icon = new TextView(this);
        icon.setText("↔");
        icon.setTextColor(ACCENT);
        icon.setTextSize(34);
        icon.setGravity(Gravity.CENTER);
        connectionPanel.addView(icon, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));

        TextView heading = new TextView(this);
        heading.setText("اتصال Alex Studio مطلوب");
        heading.setTextColor(INK);
        heading.setTextSize(20);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        heading.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams headingLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        headingLp.topMargin = dp(12);
        connectionPanel.addView(heading, headingLp);

        TextView details = new TextView(this);
        details.setText("شغّل Alex Studio على الكمبيوتر، ثم وصّل الهاتف عبر USB وفعّل USB debugging. نفّذ الأمر التالي على الكمبيوتر:");
        details.setTextColor(MUTED);
        details.setTextSize(14);
        details.setGravity(Gravity.CENTER);
        details.setLineSpacing(dp(4), 1f);
        LinearLayout.LayoutParams detailsLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        detailsLp.topMargin = dp(12);
        connectionPanel.addView(details, detailsLp);

        TextView command = new TextView(this);
        command.setText("adb reverse tcp:3000 tcp:3000");
        command.setTextColor(INK);
        command.setTextSize(13);
        command.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        command.setGravity(Gravity.CENTER);
        command.setPadding(dp(12), dp(14), dp(12), dp(14));
        command.setBackground(roundRect(Color.rgb(232, 237, 246), 12));
        LinearLayout.LayoutParams commandLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        commandLp.topMargin = dp(18);
        connectionPanel.addView(command, commandLp);

        Button retry = new Button(this);
        retry.setText("إعادة المحاولة");
        retry.setTextColor(Color.WHITE);
        retry.setAllCaps(false);
        retry.setTextSize(15);
        retry.setBackground(roundRect(ACCENT, 12));
        retry.setOnClickListener(v -> connect());
        LinearLayout.LayoutParams retryLp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52));
        retryLp.topMargin = dp(18);
        connectionPanel.addView(retry, retryLp);

        content.addView(connectionPanel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        connectionPanel.setVisibility(View.GONE);
        setContentView(shell);
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);

        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAllowed(request.getUrl());
            }

            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!isAllowed(request.getUrl())) {
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", null,
                        new ByteArrayInputStream(new byte[0]));
                }
                return super.shouldInterceptRequest(view, request);
            }

            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                showingConnectionError = false;
                progress.setVisibility(View.VISIBLE);
                statusText.setText("جارٍ الاتصال");
                connectionPanel.setVisibility(View.GONE);
            }

            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (!showingConnectionError) statusText.setText("متصل");
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request.isForMainFrame()) showConnectionPanel();
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }
        });
    }

    private boolean isAllowed(Uri uri) {
        if (uri == null || !"http".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost();
        return ("127.0.0.1".equals(host) || "localhost".equals(host)) && uri.getPort() == 3000;
    }

    private void connect() {
        showingConnectionError = false;
        connectionPanel.setVisibility(View.GONE);
        progress.setVisibility(View.VISIBLE);
        statusText.setText("جارٍ الاتصال");
        webView.loadUrl(APP_URL);
    }

    private void showConnectionPanel() {
        showingConnectionError = true;
        progress.setVisibility(View.GONE);
        statusText.setText("غير متصل");
        connectionPanel.setVisibility(View.VISIBLE);
    }

    private android.graphics.drawable.GradientDrawable roundRect(int color, int radius) {
        android.graphics.drawable.GradientDrawable drawable = new android.graphics.drawable.GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}
