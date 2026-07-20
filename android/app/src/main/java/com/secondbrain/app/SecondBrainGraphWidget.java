package com.secondbrain.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Handler;
import android.os.Looper;
import android.widget.RemoteViews;

public class SecondBrainGraphWidget extends AppWidgetProvider {

    private static final int CANVAS_SIZE = 400;
    private static Handler animationHandler;
    private static Runnable animationRunnable;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateGraphWidget(context, appWidgetManager, appWidgetId);
        }
        startAnimationLoop(context);
    }

    @Override
    public void onEnabled(Context context) {
        super.onEnabled(context);
        startAnimationLoop(context);
    }

    @Override
    public void onDisabled(Context context) {
        super.onDisabled(context);
        stopAnimationLoop();
    }

    private static void startAnimationLoop(final Context context) {
        if (animationHandler == null) {
            animationHandler = new Handler(Looper.getMainLooper());
        }
        if (animationRunnable == null) {
            animationRunnable = new Runnable() {
                @Override
                public void run() {
                    Context appContext = context.getApplicationContext();
                    AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(appContext);
                    int[] appWidgetIds = appWidgetManager.getAppWidgetIds(new ComponentName(appContext, SecondBrainGraphWidget.class));
                    
                    for (int appWidgetId : appWidgetIds) {
                        updateGraphWidget(appContext, appWidgetManager, appWidgetId);
                    }
                    animationHandler.postDelayed(this, 1500);
                }
            };
            animationHandler.postDelayed(animationRunnable, 1500);
        }
    }

    private static void stopAnimationLoop() {
        if (animationHandler != null && animationRunnable != null) {
            animationHandler.removeCallbacks(animationRunnable);
            animationRunnable = null;
        }
    }

    static void updateGraphWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.second_brain_graph_widget);

        // Draw the dynamic floating constellation bitmap
        Bitmap bitmap = Bitmap.createBitmap(CANVAS_SIZE, CANVAS_SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        
        long time = System.currentTimeMillis();

        // 1. Draw subtle sci-fi grid dots (with high transparency)
        Paint gridPaint = new Paint();
        gridPaint.setColor(Color.parseColor("#15FF5E00")); // highly translucent orange dots
        gridPaint.setStyle(Paint.Style.FILL);
        for (int i = 40; i < CANVAS_SIZE; i += 50) {
            for (int j = 40; j < CANVAS_SIZE; j += 50) {
                canvas.drawCircle(i, j, 1.5f, gridPaint);
            }
        }

        // 2. Define node positions dynamically with sine/cosine orbital drifts
        String[] labels = {"KASU", "COLLEGE", "QUEUE", "ALARM", "VOICE", "MEMORY", "WORK", "IDEAS"};
        float[][] nodes = new float[labels.length][2];
        
        float centerX = CANVAS_SIZE / 2f;
        float centerY = CANVAS_SIZE / 2f;
        float radius = 110f;

        for (int i = 0; i < labels.length; i++) {
            double angle = (2 * Math.PI * i) / labels.length;
            float baseX = centerX + (float) (Math.cos(angle) * radius);
            float baseY = centerY + (float) (Math.sin(angle) * radius);

            float driftX = (float) Math.sin((time * 0.0008) + (i * 1.5)) * 30f;
            float driftY = (float) Math.cos((time * 0.0006) + (i * 2.1)) * 30f;

            nodes[i][0] = baseX + driftX;
            nodes[i][1] = baseY + driftY;
        }

        // 3. Draw connecting lines between close neighbors
        Paint linePaint = new Paint();
        linePaint.setColor(Color.parseColor("#44FF5E00"));
        linePaint.setStrokeWidth(2.0f);
        linePaint.setAntiAlias(true);

        for (int i = 0; i < nodes.length; i++) {
            for (int j = i + 1; j < nodes.length; j++) {
                float dx = nodes[i][0] - nodes[j][0];
                float dy = nodes[i][1] - nodes[j][1];
                float dist = (float) Math.sqrt(dx * dx + dy * dy);

                if (dist < 160f) {
                    float alphaRatio = 1.0f - (dist / 160f);
                    linePaint.setAlpha((int) (alphaRatio * 110));
                    canvas.drawLine(nodes[i][0], nodes[i][1], nodes[j][0], nodes[j][1], linePaint);
                }
            }
        }

        // 4. Draw glowing nodes (without text labels for a super-minimalist 1x1 raw graph design!)
        Paint nodePaint = new Paint();
        nodePaint.setAntiAlias(true);
        nodePaint.setStyle(Paint.Style.FILL);

        for (int i = 0; i < nodes.length; i++) {
            nodePaint.setColor(Color.parseColor("#33FF5E00")); // outer glow
            canvas.drawCircle(nodes[i][0], nodes[i][1], 12f, nodePaint);

            nodePaint.setColor(Color.parseColor("#FF5E00")); // core
            canvas.drawCircle(nodes[i][0], nodes[i][1], 5f, nodePaint);
        }

        views.setImageViewBitmap(R.id.graph_image, bitmap);

        // 5. Create PendingIntent to launch MainActivity and trigger the Quick Chat modal
        Intent clickIntent = new Intent(context, MainActivity.class);
        clickIntent.setAction("com.secondbrain.app.QUICK_CHAT");
        clickIntent.putExtra("open_quick_chat", true);
        clickIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            0,
            clickIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
        );
        views.setOnClickPendingIntent(R.id.graph_image, pendingIntent);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }
}
