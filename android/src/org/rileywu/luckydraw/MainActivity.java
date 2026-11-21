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
    // overview mode zooms the layout out and fights the meta viewport on TV panels
    s.setLoadWithOverviewMode(false);
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

  private void setAudioSuspended(boolean suspended) {
    if (web == null) return;
    web.evaluateJavascript(suspended
      ? "window.__ldSuspendAudio&&window.__ldSuspendAudio()"
      : "window.__ldResumeAudio&&window.__ldResumeAudio()", null);
  }

  @Override
  protected void onPause() {
    setAudioSuspended(true);
    if (web != null) web.onPause();
    super.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) {
      web.onResume();
      setAudioSuspended(false);
    }
  }

  @Override
  protected void onStop() {
    setAudioSuspended(true);
    super.onStop();
  }

  @Override
  public void onBackPressed() {
    if (!live) {
      super.onBackPressed();
      return;
    }
    web.evaluateJavascript(
      "(function(){var s=document.getElementById('settingsPage'),o=document.getElementById('winnerOverlay');" +
      "var open=(s&&s.classList.contains('open'))||(o&&!o.classList.contains('hidden'));" +
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
    setAudioSuspended(true);
    if (web != null) web.destroy();
    super.onDestroy();
  }
}