package org.rileywu.luckydraw;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
  private static final String SHOW_URL = "https://luckydraw.rileywu.org/";
  private WebView web;
  private boolean live;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setUseWideViewPort(true);
    s.setLoadWithOverviewMode(true);
    s.setUserAgentString(s.getUserAgentString() + " LuckyDrawTV/1.0 (Android TV; Leanback)");
    web.setWebViewClient(new WebViewClient() {
      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) showOffline();
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        live = !url.startsWith("file:///android_asset/");
      }
    });
    setContentView(web);
    web.loadUrl(SHOW_URL);
  }

  private void showOffline() {
    live = false;
    web.loadUrl("file:///android_asset/error.html");
  }

  @Override
  public void onBackPressed() {
    if (!live) {
      super.onBackPressed();
      return;
    }
    web.evaluateJavascript(
      "(function(){var s=document.getElementById('settingsPage'),o=document.getElementById('winnerOverlay');" +
      "var open=(s&&!s.classList.contains('hidden'))||(o&&!o.classList.contains('hidden'));" +
      "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true}));return open;})()",
      new android.webkit.ValueCallback<String>() {
        @Override
        public void onReceiveValue(String value) {
          if (!"true".equals(value)) MainActivity.super.onBackPressed();
        }
      });
  }

  @Override
  protected void onDestroy() {
    if (web != null) web.destroy();
    super.onDestroy();
  }
}