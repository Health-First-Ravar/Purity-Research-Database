import { redirect } from 'next/navigation';

// Default landing: Research Hub / chat.
export default function Home() {
  redirect('/chat');
}
