package com.secondbrain.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;

public class SecondBrainGraphWidget extends AppWidgetProvider {

    private static final int CANVAS_SIZE = 400;

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateGraphWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateGraphWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.second_brain_graph_widget);

        // Try reading the actual rendered HTML canvas image from SharedPreferences
        SharedPreferences sharedPref = context.getSharedPreferences("SecondBrainWidget", Context.MODE_PRIVATE);
        String graphImageBase64 = sharedPref.getString("graphImageBase64", "");

        if (graphImageBase64 != null && !graphImageBase64.isEmpty()) {
            try {
                String cleanBase64 = graphImageBase64;
                if (cleanBase64.startsWith("data:image")) {
                    cleanBase64 = cleanBase64.substring(cleanBase64.indexOf(",") + 1);
                }
                byte[] decodedString = android.util.Base64.decode(cleanBase64, android.util.Base64.DEFAULT);
                Bitmap decodedByte = android.graphics.BitmapFactory.decodeByteArray(decodedString, 0, decodedString.length);
                if (decodedByte != null) {
                    views.setImageViewBitmap(R.id.graph_image, decodedByte);

                    // Setup launch intent to open the main app like standard tapping
                    Intent clickIntent = new Intent(context, MainActivity.class);
                    clickIntent.setAction(Intent.ACTION_MAIN);
                    clickIntent.addCategory(Intent.CATEGORY_LAUNCHER);
                    clickIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

                    PendingIntent pendingIntent = PendingIntent.getActivity(
                        context,
                        0,
                        clickIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
                    );
                    views.setOnClickPendingIntent(R.id.graph_image, pendingIntent);

                    appWidgetManager.updateAppWidget(appWidgetId, views);
                    return; // Successfully displayed actual app-canvas, return early!
                }
            } catch (Exception e) {
                // Fail-safe: fall back to native vector constellation below if decoding fails
            }
        }

        // Draw the dynamic floating constellation bitmap
        Bitmap bitmap = Bitmap.createBitmap(CANVAS_SIZE, CANVAS_SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);

        // 1. Draw subtle sci-fi grid dots (with high transparency)
        Paint gridPaint = new Paint();
        gridPaint.setColor(Color.parseColor("#0FFF5E00"));
        gridPaint.setStyle(Paint.Style.FILL);
        for (int i = 30; i < CANVAS_SIZE; i += 45) {
            for (int j = 30; j < CANVAS_SIZE; j += 45) {
                canvas.drawCircle(i, j, 1.2f, gridPaint);
            }
        }

        // 2. Read synced actual nodes list from SharedPreferences
        String nodesJson = sharedPref.getString("nodes", "[]");
        
        ArrayList<String> labelsList = new ArrayList<>();
        ArrayList<String> clustersList = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(nodesJson);
            for (int i = 0; i < arr.length(); i++) {
                Object item = arr.get(i);
                if (item instanceof JSONObject) {
                    JSONObject obj = (JSONObject) item;
                    labelsList.add(obj.getString("label"));
                    clustersList.add(obj.optString("cluster", "0"));
                } else {
                    labelsList.add(item.toString());
                    clustersList.add("0");
                }
            }
        } catch (Exception e) {
            // handle error silently
        }

        // Default nodes if none are synced yet
        if (labelsList.isEmpty()) {
            labelsList.add("KASU");       clustersList.add("1");
            labelsList.add("COLLEGE");    clustersList.add("1");
            labelsList.add("QUEUE");      clustersList.add("2");
            labelsList.add("ALARM");      clustersList.add("2");
            labelsList.add("VOICE");      clustersList.add("3");
            labelsList.add("MEMORY");     clustersList.add("3");
            labelsList.add("WORK");       clustersList.add("4");
            labelsList.add("IDEAS");      clustersList.add("4");
        }

        int count = labelsList.size();
        float[][] nodes = new float[count][2];
        
        float centerX = CANVAS_SIZE / 2f;
        float centerY = CANVAS_SIZE / 2f;
        
        // Define cluster centers
        // Placing 4 distinct cluster hubs at different angles
        float[][] clusterCenters = {
            { centerX + 115f, centerY - 65f },  // Hub 0 (Top-Right)
            { centerX - 115f, centerY - 65f },  // Hub 1 (Top-Left)
            { centerX - 105f, centerY + 85f },  // Hub 2 (Bottom-Left)
            { centerX + 105f, centerY + 85f }   // Hub 3 (Bottom-Right)
        };

        // Count how many nodes are in each cluster to spread them out locally
        int[] clusterNodeCounts = new int[5]; // clusters 0 to 4
        for (int i = 0; i < count; i++) {
            int cId = 0;
            try {
                cId = Integer.parseInt(clustersList.get(i)) % 4;
            } catch (Exception e) {}
            clusterNodeCounts[cId]++;
        }

        int[] clusterNodeIndex = new int[5];

        for (int i = 0; i < count; i++) {
            int cId = 0;
            try {
                cId = Integer.parseInt(clustersList.get(i)) % 4;
            } catch (Exception e) {}

            float hubX = clusterCenters[cId][0];
            float hubY = clusterCenters[cId][1];

            int idx = clusterNodeIndex[cId];
            clusterNodeIndex[cId]++;

            int totalInCluster = clusterNodeCounts[cId];
            double localAngle = totalInCluster > 1 ? (idx * 2 * Math.PI / totalInCluster) : 0;
            
            // Scatter radius of the mini-cluster constellation (e.g. 30px)
            float scatterRadius = 32f;
            nodes[i][0] = hubX + (float) Math.cos(localAngle) * scatterRadius;
            nodes[i][1] = hubY + (float) Math.sin(localAngle) * scatterRadius;

            // Add slight static organic offset based on label length to make it look natural
            float offset = (labelsList.get(i).length() * 1.5f) - 6f;
            nodes[i][0] += (float) Math.sin(i * 1.5) * offset;
            nodes[i][1] += (float) Math.cos(i * 1.1) * offset;
        }

        // 3. Draw core connections (lines from central core "YOU" to satellite clusters)
        Paint coreLinePaint = new Paint();
        coreLinePaint.setColor(Color.parseColor("#25FF5E00")); // glowing core vector
        coreLinePaint.setStrokeWidth(2.2f);
        coreLinePaint.setAntiAlias(true);
        for (int i = 0; i < count; i++) {
            canvas.drawLine(centerX, centerY, nodes[i][0], nodes[i][1], coreLinePaint);
        }

        // 4. Draw satellite-to-satellite connecting lines (for inter-node similarity!)
        Paint linePaint = new Paint();
        linePaint.setStrokeWidth(1.8f);
        linePaint.setAntiAlias(true);

        for (int i = 0; i < count; i++) {
            int cId1 = 0;
            try {
                cId1 = Integer.parseInt(clustersList.get(i)) % 5;
            } catch (Exception e) {}

            for (int j = i + 1; j < count; j++) {
                int cId2 = 0;
                try {
                    cId2 = Integer.parseInt(clustersList.get(j)) % 5;
                } catch (Exception e) {}

                // Draw connecting lines with opacity based on distance
                float dx = nodes[i][0] - nodes[j][0];
                float dy = nodes[i][1] - nodes[j][1];
                float dist = (float) Math.sqrt(dx * dx + dy * dy);

                if (dist < 150f) {
                    float alphaRatio = 1.0f - (dist / 150f);
                    
                    // Match line color with cluster color scheme!
                    String lineColor = "#15FF5E00";
                    if (cId1 == cId2) {
                        if (cId1 == 1) lineColor = "#18A833FF";
                        else if (cId1 == 2) lineColor = "#1800E5FF";
                        else if (cId1 == 3) lineColor = "#1800FF88";
                        else if (cId1 == 4) lineColor = "#18FFD600";
                    }
                    
                    linePaint.setColor(Color.parseColor(lineColor));
                    linePaint.setAlpha((int) (alphaRatio * 75));
                    canvas.drawLine(nodes[i][0], nodes[i][1], nodes[j][0], nodes[j][1], linePaint);
                }
            }
        }

        // 5. Draw glowing satellite nodes & actual synced labels
        Paint nodePaint = new Paint();
        nodePaint.setAntiAlias(true);
        nodePaint.setStyle(Paint.Style.FILL);

        Paint textPaint = new Paint();
        textPaint.setTextSize(11f); // Prominent labels to fill up space
        textPaint.setAntiAlias(true);
        textPaint.setStyle(Paint.Style.FILL);
        textPaint.setTextAlign(Paint.Align.CENTER);

        for (int i = 0; i < count; i++) {
            int cId = 0;
            try {
                cId = Integer.parseInt(clustersList.get(i)) % 5;
            } catch (Exception e) {}

            // Assign color based on cluster ID exactly like inside the app!
            String nodeColorStr = "#FF5E00";
            String glowColorStr = "#22FF5E00";
            String labelColorStr = "#FFAA66";

            if (cId == 1) {
                nodeColorStr = "#A833FF"; // Neon Purple (College/Files)
                glowColorStr = "#22A833FF";
                labelColorStr = "#D9AAFF";
            } else if (cId == 2) {
                nodeColorStr = "#00E5FF"; // Neon Cyan (Timeline/Queue)
                glowColorStr = "#2200E5FF";
                labelColorStr = "#AAFFFF";
            } else if (cId == 3) {
                nodeColorStr = "#00FF88"; // Neon Green (Voice/Memory)
                glowColorStr = "#2200FF88";
                labelColorStr = "#AAFFCC";
            } else if (cId == 4) {
                nodeColorStr = "#FFD600"; // Neon Yellow (Workspace Ideas)
                glowColorStr = "#22FFD600";
                labelColorStr = "#FFF0AA";
            }

            nodePaint.setColor(Color.parseColor(glowColorStr)); // glow ring
            canvas.drawCircle(nodes[i][0], nodes[i][1], 12f, nodePaint);

            nodePaint.setColor(Color.parseColor(nodeColorStr)); // core dot
            canvas.drawCircle(nodes[i][0], nodes[i][1], 5.5f, nodePaint);

            // Render actual node labels directly in space next to the nodes
            textPaint.setColor(Color.parseColor(labelColorStr));
            canvas.drawText(labelsList.get(i), nodes[i][0], nodes[i][1] - 12f, textPaint);
        }

        // 6. Draw central CORE Node ("YOU" / "2ND BRAIN" just like in-app!)
        nodePaint.setColor(Color.parseColor("#40FF5E00")); // Glowing core halo
        canvas.drawCircle(centerX, centerY, 24f, nodePaint);
        
        nodePaint.setColor(Color.parseColor("#FF5E00")); // Solid core dot
        canvas.drawCircle(centerX, centerY, 9f, nodePaint);

        Paint coreTextPaint = new Paint();
        coreTextPaint.setColor(Color.parseColor("#FFFFFF"));
        coreTextPaint.setTextSize(9.5f);
        coreTextPaint.setFakeBoldText(true);
        coreTextPaint.setAntiAlias(true);
        coreTextPaint.setTextAlign(Paint.Align.CENTER);
        // Center text perfectly inside the core node
        canvas.drawText("YOU", centerX, centerY + 3.8f, coreTextPaint);

        views.setImageViewBitmap(R.id.graph_image, bitmap);

        // 7. Normal launch intent to open the main app like standard tapping
        Intent clickIntent = new Intent(context, MainActivity.class);
        clickIntent.setAction(Intent.ACTION_MAIN);
        clickIntent.addCategory(Intent.CATEGORY_LAUNCHER);
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
