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
        String nodesJson = call.getString("nodesJson", "[]");
        String graphImageBase64 = call.getString("graphImageBase64", "");
        
        // Save to SharedPreferences so the Widget can read it
        SharedPreferences sharedPref = getContext().getSharedPreferences("SecondBrainWidget", Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = sharedPref.edit();
        editor.putString("reminders", remindersJson);
        editor.putString("nodes", nodesJson);
        if (graphImageBase64 != null && !graphImageBase64.isEmpty()) {
            editor.putString("graphImageBase64", graphImageBase64);
        }
        editor.apply();

        // Trigger App Widget refresh for queue
        Intent intent = new Intent(getContext(), SecondBrainWidget.class);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] ids = AppWidgetManager.getInstance(getContext()).getAppWidgetIds(new ComponentName(getContext(), SecondBrainWidget.class));
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
        getContext().sendBroadcast(intent);

        // Trigger App Widget refresh for constellation map
        Intent graphIntent = new Intent(getContext(), SecondBrainGraphWidget.class);
        graphIntent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        int[] graphIds = AppWidgetManager.getInstance(getContext()).getAppWidgetIds(new ComponentName(getContext(), SecondBrainGraphWidget.class));
        graphIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, graphIds);
        getContext().sendBroadcast(graphIntent);

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }
}
