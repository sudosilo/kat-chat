-- Rooms: the chat_messages table carries more than one chat. Cat Command Chat is room kat, Field Chat in Field Twin
-- is room field. Existing messages and anything sent without a room count as kat. Members, names, invites and
-- sign in stay shared, so one invite gets someone into both.
alter table chat_messages add column if not exists room text not null default 'kat';
create index if not exists chat_messages_room_id on chat_messages (room, id desc);
