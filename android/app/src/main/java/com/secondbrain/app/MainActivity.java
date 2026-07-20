package com.secondbrain.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecondBrainWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
