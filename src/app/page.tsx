import { redirect } from "next/navigation"
import { getAuthClient } from "@/lib/supabase/client"

export default async function Home() {
  const supabase = await getAuthClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect("/dashboard")
  } else {
    redirect("/login")
  }
}
