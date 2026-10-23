// Pass every request to the MedoFlow app unchanged. The app reads the address
// (medoflow.pages.dev or <clinic>.medoflow.pages.dev) to decide what to show.
export const onRequest = ({ request, env }) => env.APP.fetch(request)
