import { RouterProvider } from "react-router";
import { AuthProvider } from "./global/hooks/useAuth";
import { NotificationProvider } from "./global/hooks/useNotifications";
import { router } from "./routes/router";

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <RouterProvider router={router} />
      </NotificationProvider>
    </AuthProvider>
  );
}
