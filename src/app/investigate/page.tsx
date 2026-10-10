import HomeClient from "../home-client";
import { isDemoMode } from "@/lib/demo-mode";

export default function InvestigatePage() {
  return <HomeClient demoMode={false} liveDisabled={isDemoMode()} />;
}
