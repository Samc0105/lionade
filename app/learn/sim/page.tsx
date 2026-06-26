import { redirect } from "next/navigation";

// The standalone Help Desk Sim graduated into TechHub (a multi-track career
// simulator). Keep this URL working by redirecting to the new hub.
export default function HelpDeskSimRedirect() {
  redirect("/learn/techhub");
}
