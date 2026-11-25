-- Urdu-first welcome message (customers in Pakistan), English below it.
alter table public.businesses alter column bot_greeting set default
  'السلام علیکم! خوش آمدید 😊 بتائیں، آپ کیا لینا چاہیں گے؟ کسی چیز کا نام لکھ کر قیمت پوچھیں یا "آرڈر" لکھیں۔' || chr(10) || chr(10) ||
  'Hello! Ask me the price of any item or type "order".';

update public.businesses
   set bot_greeting = 'السلام علیکم! ' || name || ' میں خوش آمدید 😊 بتائیں، آپ کیا لینا چاہیں گے؟ کسی چیز کا نام لکھ کر قیمت پوچھیں یا "آرڈر" لکھیں۔' || chr(10) || chr(10) ||
                      'Hello! Ask me the price of any item or type "order".'
 where bot_greeting in ('Hi! How can I help you today?', '');
