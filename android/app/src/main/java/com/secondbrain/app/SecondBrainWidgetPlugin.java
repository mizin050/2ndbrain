package com.secondbrain.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SecondBrainWidgetPlugin")
public class SecondBrainWidgetPlugin extends Plugin {

    @PluginMethod
    public void updateWidget(PluginCall call) {
        String remindersJson = call.getString("remindersJson", "[]");
        
        // Save to SharedPreferences so the Widget can read it
        SharedPreferences sharedPref = getContext().getSharedPreferences("SecondBrainWidget", Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = sharedPref.edit();
        editor.putString("reminders", remindersJson);
        editor.apply();

        // Trigger App Widget refresh
        Intent intent = new Intent(getContext(), SecondBrainWidget.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] ids = AppWidgetManager.getInstance(getContext()).getAppWidgetIds(new ComponentName(getContext(), SecondBrainWidget.class));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        getContext().sendBroadcast(intent);

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }
}
