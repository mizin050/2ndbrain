package com.secondbrain.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class SecondBrainWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.second_brain_widget);

        // Read saved reminders from SharedPreferences
        SharedPreferences sharedPref = context.getSharedPreferences("SecondBrainWidget", Context.MODE_PRIVATE);
        String remindersJson = sharedPref.getString("reminders", "[]");

        try {
            JSONArray remindersArray = new JSONArray(remindersJson);
            int count = remindersArray.length();

            if (count == 0) {
                views.setTextViewText(R.id.reminder_item_1, "• Neural queue empty.");
                views.setViewVisibility(R.id.reminder_item_2, View.GONE);
                views.setViewVisibility(R.id.reminder_item_3, View.GONE);
            } else {
                // Populate up to 3 reminders
                for (int i = 0; i < 3; i++) {
                    int viewId = i == 0 ? R.id.reminder_item_1 : (i == 1 ? R.id.reminder_item_2 : R.id.reminder_item_3);
                    if (i < count) {
                        JSONObject rem = remindersArray.getJSONObject(i);
                        String text = rem.optString("text", "");
                        long time = rem.optLong("time", 0);
                        
                        String timeStr = "";
                        if (time > 0) {
                            SimpleDateFormat timeFormat = new SimpleDateFormat("hh:mm a", Locale.getDefault());
                            timeStr = " (" + timeFormat.format(new Date(time)) + ")";
                        }
                        
                        views.setTextViewText(viewId, "• " + text + timeStr);
                        views.setViewVisibility(viewId, View.VISIBLE);
                    } else {
                        views.setViewVisibility(viewId, View.GONE);
                    }
                }
            }
        } catch (Exception e) {
            views.setTextViewText(R.id.reminder_item_1, "• Sync initialized.");
            views.setViewVisibility(R.id.reminder_item_2, View.GONE);
            views.setViewVisibility(R.id.reminder_item_3, View.GONE);
        }

        // Set Last Update Time
        SimpleDateFormat sdf = new SimpleDateFormat("HH:mm", Locale.getDefault());
        views.setTextViewText(R.id.widget_sync_time, "LAST SYNC: " + sdf.format(new Date()));

        // Setup PendingIntent to launch main activity with quick vox flag
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction("com.secondbrain.app.QUICK_VOX");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 
                0, 
                intent, 
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.btn_quick_note, pendingIntent);

        // Instruct the widget manager to update the widget
        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
