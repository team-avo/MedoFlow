/**
 * The old setup wizard step "/welcome" (CTO-25). Signing the agreement now finishes
 * onboarding and these steps are Quick setup items on the Command Center. The
 * path stays so old links and e-mails land somewhere: the (onboarding) layout
 * sends a signed owner to /dashboard and anyone else to their next
 * application step, so this page never renders.
 */
export default function LegacyWelcomeStepPage() {
  return null
}
