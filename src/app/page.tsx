import { isDemoMode } from "@/lib/demo-mode";
import HomeClient from "./home-client";

export default function Home() {
  return <HomeClient demoMode={isDemoMode()} />;
}
