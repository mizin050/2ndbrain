package com.secondbrain.app;

import android.os.Bundle;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecondBrainWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent != null && "com.secondbrain.app.QUICK_CHAT".equals(intent.getAction())) {
            // Trigger the quick chat popup inside our web view.
            // Run instantly, and also with a 1.2 second delay as a fallback for cold-starts!
            triggerQuickChatJS();
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    triggerQuickChatJS();
                }
            }, 1200);
        }
    }

    private void triggerQuickChatJS() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript(
                "if (window.triggerQuickChatPopup) { window.triggerQuickChatPopup(); } else { window.pendingQuickChat = true; }", 
                null
            );
        }
    }
}
