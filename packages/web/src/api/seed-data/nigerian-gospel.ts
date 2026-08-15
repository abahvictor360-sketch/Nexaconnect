/**
 * Curated Nigerian gospel / Afro-gospel worship songs for the bundled library.
 * Private build - CCLI/copyright fields populated where known; users re-import
 * their own licensed songs if the app ever goes public/commercial.
 * Sections use blank lines between blocks; headers like "Chorus"/"Verse" recognized.
 */

export type SeedSong = {
  title: string;
  authors?: string[];
  copyright?: string;
  ccliNumber?: string;
  tags?: string[];
  lang?: string;
  raw: string; // full lyric text with section headers + blank-line blocks
};

export const nigerianGospel: SeedSong[] = [
  {
    title: "Way Maker",
    authors: ["Osinachi Kalu Okoro Egbu (Sinach)"],
    copyright: "© 2015 Integrity Music",
    ccliNumber: "7115744",
    tags: ["worship", "afro-gospel", "nigerian"],
    raw: `Verse 1
You are here, moving in our midst
I worship You, I worship You
You are here, working in this place
I worship You, I worship You

Chorus
Way Maker, Miracle Worker
Promise Keeper, Light in the darkness
My God, that is who You are

Verse 2
You are here, touching every heart
I worship You, I worship You
You are here, healing every heart
I worship You, I worship You

Bridge
Even when I don't see it, You're working
Even when I don't feel it, You're working
You never stop, You never stop working
You never stop, You never stop working`,
  },
  {
    title: "I Know Who I Am",
    authors: ["Sinach"],
    copyright: "© 2012 Sinach",
    tags: ["worship", "nigerian", "identity"],
    raw: `Verse 1
There's no one like You
No one else can touch my heart like You do
I could search for all eternity long and find
There is none like You

Chorus
I know who I am, I know who I am
I know who I am, I know who I am
I am Yours, I am Yours

Verse 2
Your love oh Lord, has captured my heart
And now I stand in awe of You
You reach out Your hand, You call me Your friend
There is none like You`,
  },
  {
    title: "You Are Good",
    authors: ["Nathaniel Bassey"],
    copyright: "© Nathaniel Bassey",
    tags: ["worship", "nigerian", "praise"],
    raw: `Verse 1
Oh Lord You are good
And Your mercy endureth forever
Oh Lord You are good
And Your mercy endureth forever

Chorus
People from every nation and tongue
From generation to generation
We worship You, hallelujah
We worship You, our God
We worship You, hallelujah
We worship You, our God`,
  },
  {
    title: "Imela",
    authors: ["Nathaniel Bassey"],
    copyright: "© Nathaniel Bassey",
    tags: ["worship", "nigerian", "igbo", "thanksgiving"],
    lang: "en-NG",
    raw: `Verse 1
I lift my hands and give You praise
For You are worthy of it all
From the rising of the sun
To the setting of the same

Chorus
Imela, Imela, Imela Onyekereke m
Imela, Imela, Imela Onyekereke m

Verse 2
You are the reason that I sing
You are the reason that I live
I owe it all to You my King
This life I live I owe to You`,
  },
  {
    title: "Ekwueme",
    authors: ["Prospa Ochimana"],
    copyright: "© Prospa Ochimana",
    tags: ["worship", "nigerian", "igbo"],
    lang: "en-NG",
    raw: `Verse 1
You are the one who has said it and done it
You are Ekwueme
You are the one who has said it and done it
You are Ekwueme

Chorus
Ekwueme, Ekwueme
The one who says and does
Ekwueme, Ekwueme
The one who says and does

Bridge
Miracle working God
There is no one like You
Miracle working God
There is no one like You`,
  },
  {
    title: "Great Are You Lord (Osinachi)",
    authors: ["Sinach"],
    copyright: "© Sinach",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
Great are You Lord, You are the most high God
Great are You Lord, You have done great things

Chorus
Great are You Lord, mighty in power
You are faithful, You never change
Great are You Lord`,
  },
  {
    title: "Overflow",
    authors: ["Steve Crown"],
    copyright: "© Steve Crown",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
You are great, You do great things
And You are God, there is no other

Chorus
You are the same God
You never change
Your love oh Lord, endures forever
You are the same God
Yesterday, today and forever`,
  },
  {
    title: "You Are Great",
    authors: ["Steve Crown"],
    copyright: "© Steve Crown",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
You are great, You do great things
Elshaddai, You are the same God

Chorus
Wonderful, You are wonderful
Excellent is Your name
Wonderful, You are wonderful
Excellent is Your name`,
  },
  {
    title: "Na So So Win",
    authors: ["Frank Edwards"],
    copyright: "© Frank Edwards",
    tags: ["praise", "nigerian", "pidgin"],
    lang: "en-NG",
    raw: `Verse 1
Since I gave my life to Jesus
Na so so win I dey win
Since I follow follow Jesus
Na so so win I dey win

Chorus
Na so so win, na so so win
Na so so win I dey win oh
Na so so win, na so so win
Na so so win I dey win`,
  },
  {
    title: "You Too Dey Bam",
    authors: ["Frank Edwards"],
    copyright: "© Frank Edwards",
    tags: ["praise", "nigerian", "pidgin"],
    lang: "en-NG",
    raw: `Verse 1
Some people dey call You awesome God
Some people dey call You mighty God
But as for me I go call You
You too dey bam

Chorus
You too dey bam, You too dey bam
My God oh, You too dey bam
You too dey bam, You too dey bam
My God oh, You too dey bam`,
  },
  {
    title: "Miracle No Dey Tire Jesus",
    authors: ["Moses Bliss"],
    copyright: "© Moses Bliss",
    tags: ["praise", "nigerian", "pidgin"],
    lang: "en-NG",
    raw: `Verse 1
Miracle no dey tire Jesus oh
Anointing no dey tire Jesus oh
Miracle no dey tire Jesus oh
My God, my God

Chorus
E no dey tire You, e no dey tire You
Miracle no dey tire Jesus
E no dey tire You, e no dey tire You
Miracle no dey tire Jesus`,
  },
  {
    title: "Too Faithful",
    authors: ["Nathaniel Bassey", "Chandler Moore"],
    copyright: "© Nathaniel Bassey",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
When I remember all You've done for me
I cannot tell it all
Blessings without number, mercies like the morning
All my life You have been faithful

Chorus
Too faithful, too faithful
To fail me now, You are too faithful
Too faithful, too faithful
To fail me now, You are too faithful`,
  },
  {
    title: "Olowogbogboro",
    authors: ["Nathaniel Bassey"],
    copyright: "© Nathaniel Bassey",
    tags: ["worship", "nigerian", "yoruba"],
    lang: "en-NG",
    raw: `Verse 1
There is nothing my God cannot do
There is nothing my God cannot do

Chorus
Olowogbogboro, the God whose hands are long
Olowogbogboro, there is nothing You cannot do

Bridge
Reach out and touch somebody now
There is nothing my God cannot do`,
  },
  {
    title: "Onise Iyanu",
    authors: ["Nathaniel Bassey"],
    copyright: "© Nathaniel Bassey",
    tags: ["worship", "nigerian", "yoruba"],
    lang: "en-NG",
    raw: `Verse 1
Who else could ever conquer
The grave and rise again
Who else could ever fashion
The heavens with His hands

Chorus
Onise iyanu, worker of wonders
Onise iyanu, worker of wonders
Ki lo se ti O le se, what can't You do
Ki lo se ti O le se, what can't You do`,
  },
  {
    title: "Igwe",
    authors: ["Midnight Crew"],
    copyright: "© Midnight Crew",
    tags: ["worship", "nigerian", "igbo"],
    lang: "en-NG",
    raw: `Verse 1
Igwe, You are the mighty God
The great I Am, that is who You are
Igwe, You are the mighty God
The great I Am, that is who You are

Chorus
Igwe, Igwe, Igwe
You are the mighty God
Igwe, Igwe, Igwe
You are the great I Am`,
  },
  {
    title: "Chinedum",
    authors: ["Mercy Chinwo"],
    copyright: "© Mercy Chinwo",
    tags: ["worship", "nigerian", "igbo"],
    lang: "en-NG",
    raw: `Verse 1
You lead me, You guide me
Through it all You've been my keeper
You lead me, You guide me
Chinedum, my leader

Chorus
Chinedum, Chinedum
You are the one who leads me
Chinedum, Chinedum
You are the one who guides me`,
  },
  {
    title: "Excess Love",
    authors: ["Mercy Chinwo"],
    copyright: "© Mercy Chinwo",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
You love me anyhow
Excess love, You love me anyhow
Ihunanya gi nwoke oh
Excess love, You love me anyhow

Chorus
Excess love, excess love
You love me anyhow
Excess love, excess love
You love me anyhow`,
  },
  {
    title: "Obinasom",
    authors: ["Mercy Chinwo"],
    copyright: "© Mercy Chinwo",
    tags: ["worship", "nigerian", "igbo"],
    lang: "en-NG",
    raw: `Verse 1
You are the one that lives in my heart
Obinasom, You never leave me
You are the one that lives in my heart
Obinasom, You never leave me

Chorus
Obinasom, Obinasom
The one who lives in my heart
Obinasom, Obinasom
You never leave me alone`,
  },
  {
    title: "Bless Me",
    authors: ["Mercy Chinwo"],
    copyright: "© Mercy Chinwo",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
The heavens are open over me
The blessings are falling on me
I receive it, I receive it
I receive my blessing

Chorus
Bless me indeed
Enlarge my coast
Let Your hand be with me
And keep me from all evil`,
  },
  {
    title: "Wonder",
    authors: ["Sinach"],
    copyright: "© Sinach",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
You are a wonder, wonderful God
There is no one like You
You are a wonder, wonderful God
There is no one like You

Chorus
What a wonder, what a wonder
You are a wonder to me
What a wonder, what a wonder
You are a wonder to me`,
  },
  {
    title: "Champion",
    authors: ["Sunmisola Agbebi", "Nathaniel Bassey"],
    copyright: "© Nathaniel Bassey",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
You reign in power
You reign in glory
You silence the enemy
You are a champion

Chorus
You are a champion
Champion, You are a champion
The battle is Yours and the victory too
You are a champion`,
  },
  {
    title: "Jireh (My Provider)",
    authors: ["Limoblaze"],
    copyright: "© Limoblaze",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
You are more than enough for me
Jireh, You are enough
More than enough for me
Jireh, You are enough

Chorus
Jehovah Jireh, my provider
More than enough for me
Jehovah Jireh, my provider
More than enough for me`,
  },
  {
    title: "Gratitude",
    authors: ["Nathaniel Bassey"],
    copyright: "© Nathaniel Bassey",
    tags: ["worship", "nigerian", "thanksgiving"],
    raw: `Verse 1
All I have is a heart of thanksgiving
All I have is a life to give
All I have is a song of gratitude
For all the things You've done for me

Chorus
So I say thank You, thank You Lord
For all the things You've done for me
So I say thank You, thank You Lord
Forever grateful I will be`,
  },
  {
    title: "The Same God",
    authors: ["Nathaniel Bassey"],
    copyright: "© Nathaniel Bassey",
    tags: ["worship", "nigerian"],
    raw: `Verse 1
The God of Abraham
The God of Isaac
The God of Jacob
You're the same God

Chorus
You are the same God
You never change, You never fail
You are the same God
Yesterday, today, forever`,
  },
  {
    title: "Ese Baba (Thank You Father)",
    authors: ["Preye Odede"],
    copyright: "© Preye Odede",
    tags: ["worship", "nigerian", "yoruba", "thanksgiving"],
    lang: "en-NG",
    raw: `Verse 1
Ese baba, ese baba
Thank You Lord for all You've done
Ese baba, ese baba
Thank You Lord for all You've done

Chorus
Ese o, ese o, ese baba
Thank You Lord
Ese o, ese o, ese baba
Thank You Lord`,
  },
];
