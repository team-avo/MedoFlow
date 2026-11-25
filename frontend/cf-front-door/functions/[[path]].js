// Pass every request to the MedoFlow app unchanged. The app reads the address
// (medoflow.pages.dev or <clinic>.medoflow.pages.dev) to decide what to show.
// After the medoflow.com migration the app Worker 308s these retired pages.dev
// addresses to medoflow.com (cf-worker.js -> retiredHostRedirect), so this front
// door keeps working for old links with no redeploy here.
export const onRequest = ({ request, env }) => env.APP.fetch(request)
