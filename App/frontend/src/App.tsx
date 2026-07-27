import { RouterProvider } from "react-router";
import { AuthProvider } from "./global/hooks/useAuth";
import { NotificationProvider } from "./global/hooks/useNotifications";
import { RecordingSessionProvider } from "./meetings/libs/hooks/RecordingSessionProvider";
import { router } from "./routes/router";

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <RecordingSessionProvider>
          <RouterProvider router={router} />
        </RecordingSessionProvider>
      </NotificationProvider>
    </AuthProvider>
  );
}
