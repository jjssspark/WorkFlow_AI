package com.workflowai.roadmap;

import java.util.List;

public record RoadmapTaskLayoutRequest(
    List<RoadmapTaskLayoutItem> items
) {
}
