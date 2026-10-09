create extension if not exists pg_net;
create or replace function notify_push() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://kat-chat-flame.vercel.app/api/push',
    body := jsonb_build_object('id', new.id),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
end
$$;
drop trigger if exists chat_messages_push on chat_messages;
create trigger chat_messages_push after insert on chat_messages for each row execute function notify_push();
