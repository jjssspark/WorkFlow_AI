import { RouterProvider } from "react-router";
import { AuthProvider } from "./global/hooks/useAuth";
import { RecordingSessionProvider } from "./meetings/libs/hooks/RecordingSessionProvider";
import { router } from "./routes/router";

export default function App() {
  return (
    <AuthProvider>
      <RecordingSessionProvider>
        <RouterProvider router={router} />
      </RecordingSessionProvider>
    </AuthProvider>
  );
}
