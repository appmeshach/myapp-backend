export type CategoryNode = {
  [key: string]: CategoryNode | string[];
};

export const categoryTree: CategoryNode = {
  "Fashion & Wearables": {
    "Women's clothing": {
      "Tops & Blouses": [
        "Shirts",
        "Blouses",
        "T-shirts",
        "Tank tops",
        "Camis",
        "Bodysuits",
      ],
      Dresses: [
        "Long dresses",
        "Midi dresses",
        "Short dresses",
        "Evening dresses",
        "Party dresses",
        "Wedding dresses",
        "Long sleeve dresses",
      ],
      "Suits & Co-ords": [
        "Suits & blazers",
        "Co-ordinates",
        "Skirt & dress suits",
      ],
      Bottoms: [
        "Pants",
        "Trousers",
        "Leggings",
        "Skirts",
        "Shorts",
        "Denim / jeans",
      ],
      "Sweaters & Knitwear": [
        "Sweaters",
        "Cardigans",
        "Knit tops",
      ],
      Outerwear: [
        "Coats",
        "Jackets",
        "Vests",
        "Kimonos",
        "Capes",
      ],
      Activewear: [
        "Women’s sportswear",
        "Leggings sets",
        "Workout tops",
      ],
      Jumpsuits: [
        "Jumpsuits",
        "Rompers",
        "Playsuits",
        "Overalls",
      ],
      "Swimwear & Beachwear": [
        "Swimsuits",
        "Cover-ups",
        "Beachwear",
      ],
      "Lingerie & Sleepwear": [
        "Lingerie",
        "Underwear",
        "Sleepwear",
        "Loungewear",
      ],
      "Cultural wear": [
        "Islamic wear",
        "Modest dresses",
        "Cultural outfits",
      ],
      "Maternity wear": [
        "Maternity dresses",
        "Maternity tops & bottoms",
      ],
      "Ready to wear": [
        "Pre-styled outfits",
        "Complete looks",
      ],
    },

    "Men's clothing": {
      Tops: [
        "T-Shirts & Tanks",
        "Shirts (Casual & Dress)",
        "Polos",
        "Hoodies & Sweatshirts",
        "Sweaters & Knitwear",
      ],
      Bottoms: [
        "Jeans & Denim",
        "Trousers & Pants",
        "Cargo Pants",
        "Shorts",
        "Sweatpants",
      ],
      Outerwear: ["Jackets", "Coats", "Vests"],
      "Suits & Sets": [
        "Suits & Separates",
        "Co-ords / Sets",
        "Sport Suits",
      ],
      Activewear: [
        "Sportswear",
        "Jerseys",
        "Overalls",
      ],
      "Underwear & Sleepwear": [
        "Underwear",
        "Sleep & Lounge",
      ],
      Swimwear: ["Swimwear"],
      "Traditional or (Trad) Wear": ["Traditional wear"],
    },

    "Kids fashion": {
      "Baby (0–3 yrs)": [
        "Baby Sets",
        "One-Pieces & Rompers",
        "Baby Dresses",
        "Baby Tops",
        "Baby Bottoms",
        "Baby Sleepwear",
        "Baby Underwear & Socks",
        "Baby Outerwear",
        "Baby Accessories",
      ],
      "Girls Clothing (4–12 yrs)": [
        "Dresses",
        "Sets",
        "Tops & T-Shirts",
        "Bottoms",
        "Outerwear",
        "Sleepwear & Pajamas",
        "Underwear & Socks",
        "Swimwear",
        "Costumes & Party Wear",
      ],
      "Boys Clothing (4–12 yrs)": [
        "Sets",
        "Tops & T-Shirts",
        "Shirts & Polos",
        "Bottoms",
        "Outerwear",
        "Sleepwear & Pajamas",
        "Underwear & Socks",
        "Swimwear",
        "Costumes & Occasion Wear",
      ],
      "Teen Wear (13–16 yrs)": {
  "Teen Girls Clothing": [
    "Dresses",
    "Sets",
    "Tops & T-Shirts",
    "Bottoms",
    "Outerwear",
    "Sleepwear & Pajamas",
    "Underwear & Socks",
    "Swimwear",
    "Costumes & Party Wear",
  ],
  "Teen Boys Clothing": [
    "Sets",
    "Tops & T-Shirts",
    "Shirts & Polos",
    "Bottoms",
    "Outerwear",
    "Sleepwear & Pajamas",
    "Underwear & Socks",
    "Swimwear",
    "Costumes & Occasion Wear",
  ],
},
      "Kids Accessories (All Ages)": [
        "Bags & Backpacks",
        "Hats, Caps & Scarves",
        "Socks & Tights",
        "Watches & Jewelry",
        "Eyewear",
        "Belts & Suspenders",
        "Hair Accessories",
        "Buttons, Pins & Keychains",
      ],
    },

    Shoes: {
      "Women's Shoes": [
        "Sneakers & Canvas",
        "Flats & Ballerinas",
        "Heels & Pumps",
        "Sandals & Slippers",
        "Boots",
        "Loafers & Slip-Ons",
        "Mules & Clogs",
        "Work & Safety Shoes",
        "Sports & Athletic Shoes",
        "Outdoor & Utility Shoes",
      ],
      "Men's Shoes": [
        "Sneakers & Canvas",
        "Casual Shoes",
        "Formal Shoes",
        "Loafers & Slip-Ons",
        "Sandals & Slippers",
        "Boots",
        "Work & Safety Shoes",
        "Sports & Athletic Shoes",
        "Outdoor Shoes",
        "Mules & Clogs",
      ],
      "Kids' Shoes": [
        "Sneakers",
        "Sandals & Slippers",
        "Flats & Pumps",
        "Boots",
        "School Shoes",
        "Sports Shoes",
        "Water Shoes",
        "Clogs & Mules",
      ],
      "Shoe Accessories & Care": [
        "Shoe Accessories",
        "Shoe Care",
        "Shoe Decorations & Charms",
        "Insoles & Laces",
      ],
    },

    "Underwear & Sleepwear": {
      "Women’s underwear & sleepwear": {
        "Everyday Underwear": [
          "Briefs",
          "Hipsters",
          "Bikini underwear",
          "Boyshorts",
          "Seamless underwear",
          "Cotton underwear",
        ],
        "Sleepwear & Nightwear": [
          "Pyjama sets",
          "Night gowns",
          "Sleep dresses",
          "Sleep shirts",
          "Sleep shorts & pants",
        ],
        Loungewear: [
          "Lounge sets",
          "Home wear",
          "Relaxed indoor clothing",
          "Soft casual wear",
        ],
        "Socks & Hosiery": [
          "Ankle socks",
          "Long socks",
          "Stockings",
          "Tights",
          "Pantyhose",
        ],
        Shapewear: [
          "Tummy control underwear",
          "Waist trainers",
          "Shaping shorts",
          "Body shapers",
        ],
        "Curve / Plus-Size Underwear & Sleepwear": [
          "Plus-size underwear",
          "Plus-size pyjamas",
          "Plus-size loungewear",
          "Comfort-fit sleepwear",
        ],
      },

      "Men’s Underwear & Sleepwear": {
        Underwear: [
          "Briefs",
          "Boxers",
          "Boxer briefs",
          "Trunks",
        ],
        "Sleepwear & Loungewear": [
          "Pyjamas",
          "Nightwear",
          "Lounge sets",
        ],
        "Socks & Hosiery": [
          "Ankle socks",
          "Crew socks",
          "Long socks",
          "Dress socks",
          "Sports socks",
          "Thermal socks",
        ],
        "Thermal & Base Layers": [
          "Thermal tops",
          "Thermal bottoms",
          "Full thermal sets",
          "Cold-weather base layers",
        ],
        Shapewear: [
          "Compression underwear",
          "Body shaping shorts",
          "Waist control garment",
        ],
      },

      "Kids Underwear & Sleepwear": {
        Underwear: [
          "Kids briefs",
          "Kids boxers",
          "Kids underwear sets",
        ],
        "Sleepwear & Pyjamas": [
          "Pyjamas set",
          "Nightwear",
          "Sleep shirt",
          "Sleep pants",
        ],
        Socks: [
          "Kids ankle socks",
          "School socks",
          "Warm socks",
        ],
      },
    },

    "Lingerie & Loungewear": {
  "Women’s lingerie": {
    "Bras & Bralettes": [
      "Bras (wired, wireless)",
      "Bralettes",
      "Push-up bras",
      "Sports-style lingerie bras",
    ],
    "Panties & briefs": [
      "Thongs",
      "Bikini panties",
      "Lace briefs",
      "High waist panties",
      "Seamless panties",
    ],
    "Lingerie Sets": [
      "Bra & panty sets",
      "Matching lingerie sets",
      "Coordinated lace sets",
    ],
    "Sexy & erotic lingerie": [
      "Bodysuits",
      "Teddies",
      "Babydolls",
      "Sheer/mesh lingerie",
      "Erotic lingerie sets",
    ],
    "Shapewear & Corsetry": [
      "Corsets",
      "Bustiers",
      "Waist cinchers",
      "Body shapers",
      "Control slips",
    ],
    "Stockings & Hosiery": [
      "Stockings",
      "Thigh-highs",
      "Fishnets",
      "Lace hosiery",
      "Pantyhose",
    ],
    "Lingerie Accessories": [
      "Garters",
      "Lingerie straps",
      "Bra extenders",
      "Decorative lingerie add-ons",
    ],
  },

  "Women’s loungewear": {
    "Lounge Sets": [
      "Matching lounge tops & bottoms",
      "Soft fabric sets",
      "Home wear sets",
    ],
    "Robes & Cover-ups": [
      "Robes",
      "Dressing gowns",
      "Lightweight cover-ups",
    ],
    "Sleep Shorts & Lounge Bottoms": [
      "Sleep shorts",
      "Lounge pants",
      "Relaxed-fit bottoms",
    ],
  },

  "Men’s Loungewear": {
    "Lounge Sets": [
      "Home wear sets",
      "Relaxed tops & bottoms",
      "Indoor casual wear",
    ],
    "Sleep & Lounge Tops": [
      "Lounge T-shirts",
      "Sleep shirts",
      "Soft indoor tops",
    ],
    "Sleep & Lounge Bottoms": [
      "Lounge pants",
      "Sleep shorts",
      "Relaxed home trousers",
    ],
  },
},
    "Beachwear & Swimwear": {
  "Women’s Beachwear & Swimwear": {
    "Bikini Sets": [
      "Two-piece bikinis",
      "3-piece bikini sets",
    ],
    "One-Piece Swimsuits": [
      "Classic one-pieces",
      "Fashion one-pieces",
      "Modest styles",
    ],
    Tankinis: [
      "Tankini tops with bottoms",
    ],
    "Swim Tops & Bottoms (Mix & Match)": [
      "Bikini tops",
      "Bikini bottoms",
    ],
    "Cover-Ups & Resort Wear": [
      "Cover-ups",
      "Kimonos",
      "Beach dresses",
      "Sheer wraps",
    ],
    "Rash Guards & Swim Shirts": [
      "UV-protective swim tops",
    ],
    "Beach Bottoms & Shorts": [
      "Beach shorts",
      "Board shorts",
      "Beach pants",
    ],
    "Modest & Specialty Swimwear": [
      "Burkinis",
      "Long-sleeve swim sets",
    ],
  },

  "Curve / Plus-Size Beachwear": {
    "Curve Bikini Sets": [
      "Curve bikini sets",
    ],
    "Curve One-Piece Swimsuits": [
      "Curve one-piece swimsuits",
    ],
    "Curve Tankinis": [
      "Curve tankinis",
    ],
    "Curve Swim Tops & Bottoms": [
      "Curve swim tops",
      "Curve swim bottoms",
    ],
    "Curve Cover-Ups & Beach Dresses": [
      "Curve cover-ups",
      "Curve beach dresses",
    ],
    "Curve Rash Guards": [
      "Curve rash guards",
    ],
    "Curve Modest Swimwear": [
      "Curve modest swimwear",
    ],
  },

  "Maternity Beachwear": {
    "Maternity One-Piece Swimsuits": [
      "Maternity one-piece swimsuits",
    ],
    "Maternity Bikini Sets": [
      "Maternity bikini sets",
    ],
    "Maternity Tankinis": [
      "Maternity tankinis",
    ],
    "Maternity Cover-Ups": [
      "Maternity cover-ups",
    ],
  },

  
    "Men’s Swimwear": [
      "Swim shorts",
      "Beach shorts",
      "Board shorts",
      "Swim trunks",
    ],
"Kids & Baby Swimwear": {
    "Girls’ Swimwear": [
      "Girls’ swimsuits",
      "Girls’ swim sets",
      "Girls’ rash guards",
    ],
    "Boys’ Swimwear": [
      "Boys’ swim shorts",
      "Boys’ swim sets",
      "Boys’ rash guards",
    ],
    "Baby Swimwear": [
      "Baby swimsuits",
      "Baby swim sets",
      "Baby rash guards",
    ],
  },
},
    "Jewelry & Accessories": {
  "Women’s Jewelry": [
  "Necklaces & Pendants",
  "Earrings",
  "Bracelets & Bangles",
  "Rings",
  "Anklets & Body Jewelry",
  "Religious Jewelry",
  "Wedding & Engagement Jewelry",
  "Jewelry Sets",
],

  "Men’s Jewelry": [
  "Necklaces & Chains",
  "Bracelets",
  "Rings",
  "Earrings",
  "Religious Jewelry",
  "Wedding Rings",
  "Tie Pins & Cufflinks",
],

  "Hair Accessories": [
  "Hair bands & scrunchies",
  "Hair clips & pins",
  "Headbands",
  "Hair claws",
  "Decorative hair accessories",
  ],


  "Eyewear & Accessories": {
    Sunglasses: [
      "Women’s sunglasses",
      "Men’s sunglasses",
      "Unisex sunglasses",
    ],
    "Eyeglasses frames": [
      "Eyeglasses frames",
    ],
    "Glasses chains & holders": [
      "Glasses chains",
      "Glasses holders",
    ],
    "Eyewear cases & cleaning kits": [
      "Eyewear cases",
      "Cleaning kits",
    ],
  },

  "Hats, Caps & Headwear": {
    "Hats & caps": [
      "Women’s hats & caps",
      "Men’s hats & caps",
    ],
    Earmuffs: [
      "Earmuffs",
    ],
    "Head wraps & turbans": [
      "Head wraps",
      "Turbans",
    ],
    "Face coverings": [
      "Face coverings",
    ],
  },

  "Scarves, Wraps & Gloves": [
    "Scarves & wraps",
    "Gloves & mittens",
    "Hand fans",
    "Seasonal cold-weather accessories",
    ],

  "Belts, Ties & Suspenders": {
    Belts: [
      "Women’s belts",
      "Men’s belts",
    ],
    "Ties & bow ties": [
      "Ties",
      "Bow ties",
    ],
    Suspenders: [
      "Suspenders",
    ],
    "Collar accessories": [
      "Collar accessories",
    ],
  },

  "Keychains, Charms & Small Accessories": [
    "Keyrings & keychains",
    "Bag charms",
    "Decorative charms",
    "Handbag hangers",
    ],
  "Costume & Special Occasion Accessories": [
    "Costume jewelry",
    "Costume wigs",
    "Faux collars",
    "Appliqué patches",
    "Buttons & pins",
    "Wedding accessories",
    "Themed or novelty accessories",
    ],

  "Personalized & Customized Accessories": [
    "Personalized jewelry",
    "Engraved rings & bracelets",
    "Customized watches",
    "Name necklaces",
    "Initial accessories",
    ],

  "Jewelry Care, Storage & DIY": {
    "Jewelry boxes & organizers": [
      "Jewelry boxes",
      "Jewelry organizers",
    ],
    "Jewelry cleaning & care": [
      "Jewelry cleaning",
      "Jewelry care",
    ],
    "Watch straps & accessories": [
      "Watch straps",
      "Watch accessories",
    ],
    "Loose gemstones": [
      "Loose gemstones",
    ],
    "Jewelry-making supplies": [
      "Beads",
      "Charms",
      "Findings",
    ],
  },

  "Kids’ Jewelry & Accessories": [
    "Kids jewelry",
    "Hair accessories",
    "Hats & caps",
    "Gloves",
    "Scarves & small accessories",
    ],
},
    "Bags & Luggage": {
  "Women’s Bags": [
    "Shoulder bags",
    "Handbags & purses",
    "Tote bags",
    "Crossbody bags",
    "Top-handle bags",
    "Satchels & hobo bags",
    "Evening bags & clutches",
    "Backpacks",
    "Waist & arm bags",
    "Wristlets",
    "Bag sets",
    ],

  "Men’s Bags": [
    "Backpacks",
    "Crossbody & messenger bags",
    "Briefcases",
    "Tote bags",
    "Waist & chest bags",
    "Wristlets & clutches",
    "Laptop & work bags",
    "Bag sets",
    ],

  "Kids’ Bags": [
    "School backpacks",
    "Kids backpacks & bookbags",
    "Lunch bags",
    "Drawstring bags",
    "Kids travel bags",
    ],
  "Wallets & Small Leather Goods": {
    "Wallets (short & long)": [
      "Wallets (short & long)",
    ],
    Cardholders: [
      "Cardholders",
    ],
    "Coin purses": [
      "Coin purses",
    ],
    "Phone wallets": [
      "Phone wallets",
    ],
    "Key cases": [
      "Key cases",
    ],
    "Wristlet wallets": [
      "Wristlet wallets",
    ],
    "Money clips": [
      "Money clips",
    ],
  },

  "Backpacks & Daypacks": [
    "Everyday backpacks",
    "Fashion backpacks",
    "School & student backpacks",
    "Laptop backpacks",
    "Hiking & outdoor daypacks",
    "Gym backpacks",
    ],

  "Crossbody, Messenger & Work Bags": [
    "Crossbody bags",
    "Messenger bags",
    "Satchels",
    "Laptop & office bags",
    "Professional & hobby cases",
    ],

  "Luggage & Travel Bags": [
    "Suitcases",
    "Luggage sets",
    "Carry-on luggage",
    "Rolling luggage",
    "Duffel & travel bags",
    "Garment bags",
    "Kids luggage",
    ],

  "Travel Essentials & Organizers": [
    "Packing organizers",
    "Passport covers & travel wallets",
    "Toiletry & makeup bags",
    "Travel storage bags",
    "Luggage tags & straps",
    ],

  "Bag Accessories & Parts": [
    "Bag charms",
    "Bag straps",
    "Bag inserts & organizers",
    "Bag covers",
    "DIY bag accessories",
    "Replacement handles & hardware",
    ],

  "Specialty & Utility Bags": [
    "Lunch & cooler bags",
    "Cosmetic & toiletry bags",
    "Shopping & reusable bags",
    "Storage bags",
    "Seasonal & novelty bags",
    ],

  "Custom & Personalized Bags": [
    "Customized women’s bags",
    "Personalized travel bags",
    "Custom wallets & pouches",
    "Engraved or name-printed bags",
    ],

},
    "Hair extensions & Wigs": {
  "Lace Wigs": {
    "Human hair lace wigs": [
      "Human hair lace wigs",
    ],
    "Synthetic lace wigs": [
      "Synthetic lace wigs",
    ],
    "Blended lace wigs": [
      "Blended lace wigs",
    ],
    "Lace front wigs": [
      "Lace front wigs",
    ],
    "Full lace wigs": [
      "Full lace wigs",
    ],
  },

  "Non-Lace & Specialty Wigs": [
    "Machine-made wigs",
    "U-part wigs",
    "V-part wigs",
    "Toppers & hair systems",
    "Toupees",
    "Costume & theatrical wigs",
    ],

  "Hair Extensions & Weaves": [
    "Human hair bundles & weaves",
    "Synthetic hair weaves & blends",
    "Clip-in extensions",
    "Tape-in extensions",
    "Sew-in extensions",
    ],

  "Braiding & Bulk Hair": [
    "Bulk braiding hair",
    "Crochet hair",
    "Braiding extensions",
    "Twisting & loc hair",
    ],

  "Closures & Hair Pieces": [
    "Lace closures",
    "Lace frontals",
    "Ponytails",
    "Bangs & fringe pieces",
    "Buns & add-on hair pieces",
    "Theatrical & facial hair",
    ],

  "Ponytails, Bangs & Quick Styles": [
    "Ponytail extensions",
    "Clip-on bangs",
    "Drawstring ponytails",
    "Quick-style hair pieces",
    ],

  "Wig Caps, Tools & Accessories": [
    "Wig caps, nets & liners",
    "Adhesives, tapes & removers",
    "Application tools & kits",
    "Combs & wig brushes",
    ],

  "Stands, Mannequins & Storage": [
    "Wig stands",
    "Mannequin heads",
    "Storage bags & boxes",
    "Display tools",
    ],

  "Hair Care for Wigs & Extensions": [
    "Wig shampoos",
    "Wig conditioners",
    "Hair treatment & care products",
    "Maintenance sprays",
    ],

  "Salon & Professional Essentials": [
    "Salon hair supplies",
    ],
},
    Watches: {
  "Men’s Watches": [
    "Analog wrist watches",
    "Digital watches",
    "Chronograph watches",
    "Dress watches",
    "Sports watches",
    ],

  "Women’s Watches": [
    "Fashion watches",
    "Dress watches",
    "Bracelet watches",
    "Minimal & classic styles",
    ],

  "Unisex & Couple Watches": [
    "Unisex watch designs",
    "Couple / matching watch sets",
    ],

  "Smart Watches & Wearable Tech": [
    "Smart watches",
    "Fitness & activity watches",
    "Hybrid smart watches",
    ],

  "Pocket & Specialty Watches": [
    "Pocket watches",
    "Fob watches",
    "Novelty & collector watches",
    ],

  "Kids’ Watches": [
    "Boys’ watches",
    "Girls’ watches",
    "Learning & fun-design watches",
    ],

  "Customized & Personalized Watches": [
    "Engraved watches",
    "Personalized name or photo watches",
    "Gift watches",
    ],

  "Watch Accessories, Parts & Care": [
    "Watch bands & straps",
    "Watch parts & repair items",
    "Watch boxes & winders",
    "Cleaning & care tools",
    ],
},
    "Costumes & Special occasion wear": {
  "Lingerie & Exotic Apparel": {
    "Bodysuits & Teddies": [
      "Lace bodysuits",
      "Leather teddies",
      "Exotic one-pieces",
    ],
    "Babydolls, Slips & Gowns": [
      "Night slips",
      "Sheer gowns",
      "Flowing pieces",
    ],
    "Lingerie Sets": [
      "Matched bra & panty sets",
      "Themed sets",
    ],
    "Bras & Panties": [
      "Standalone pieces",
      "Specialty designs",
    ],
    "Tops & Bottoms": [
      "Corset tops",
      "Harness bottoms",
      "Fetish skirts",
    ],
    "Accessories & Hosiery": [
      "Stockings",
      "Garters",
      "Gloves",
      "Chokers",
    ],
  },

  "Functional & Performance Apparel": {
    "Performance Apparel": [
      "Protective suits",
      "Tactical wear",
      "Stage performance outfits",
    ],
    "Performance Accessories": [
      "Ropes",
      "Harnesses",
      "Belts",
      "Protective gear",
    ],
  },

  "Traditional & Cultural Wear": {
    "African & Middle Eastern": [
      "Agbada",
      "Kaftans",
      "Jalabiya",
      "Traditional gowns",
    ],
    "Asian & Pacific": [
      "Kimono",
      "Hanfu",
      "Cheongsam",
      "Cultural robes",
    ],
    "European & American": [
      "Folk costumes",
      "Historical attire",
      "Ceremonial dress",
    ],
  },

  "Workwear & Uniforms": {
    "Institutional & Corporate": [
      "Office uniforms",
      "Security uniforms",
    ],
    "Industrial & Trade": [
      "Coveralls",
      "Mechanic wear",
      "Safety outfits",
    ],
    "Medical & Healthcare": [
      "Scrubs",
      "Lab coats",
      "Medical uniforms",
    ],
    "Hospitality & Food Service": [
      "Chef wear",
      "Waiter uniforms",
      "Aprons",
    ],
  },

  "Performance & Dancewear": {
    "Leotards & Performance Wear": [
      "Gymnastics wear",
      "Ballet wear",
      "Stage wear",
    ],
    "Dance Shoes & Accessories": [
      "Dance heels",
      "Ballet shoes",
      "Foot accessories",
    ],
    "LED & Theatrical Wear": [
      "Light-up outfits",
      "Stage effects clothing",
    ],
    "Street Dance & Hip-Hop": [
      "Battle outfits",
      "Oversized performance wear",
    ],
    "Themed & Cultural Dance": [
      "Traditional dance costumes",
      "Festival dancewear",
    ],
  },

  "Costumes & Cosplay": {
    "Full Costumes & Sets": [
      "Complete character outfits",
    ],
    "Props, Wigs & Accessories": [
      "Masks",
      "Weapons",
      "Cosplay wigs",
    ],
    "Themed & Mascot Costumes": [
      "Animal costumes",
      "Character costumes",
      "Branded mascots",
    ],
  },
},
  },

  "Electronics & Power": {
    "Phones & Accessories": {
      "Mobile phones": [
        "Smartphones",
        "Feature phone",
      ],
      "Phone cases, Covers & Protection": [
        "Protective Cases & Covers",
        "Wallet & Cardholder Cases",
        "Fashion & Decorative Cases",
        "Custom & Personalized Cases",
        "Armbands",
        "Holsters & Pouches",
        "Waterproof & Outdoor Cases",
      ],
      "Screen & Camera Protection": [
        "Screen Protectors",
        "Camera Lens Protectors",
        "Back Films & Stickers",
      ],
      "Charging & Power": [
        "Chargers & Adapters",
        "Cables & Adapters",
        "Wireless Chargers",
        "Power Banks & Battery Cases",
        "Charging Stands & Docks",
        "Cable Organizers & Protectors",
      ],
      "Holders, Mounts & Stands": [
        "Phone Stands",
        "Car Mounts & Cradles",
        "Bike & Handlebar Mounts",
        "Grip Holders & Ring Holders",
        "Gooseneck & Flexible Mounts",
      ],
      "Audio & Communication Accessories": [
        "Earphones & Headsets",
        "Bluetooth Accessories",
        "Microphones",
        "Walkie-Talkies & Accessorie",
      ],
      "Photography & Content Creation": [
        "Selfie Sticks & Tripods",
        "Phone Lenses & Filters",
        "Ring Lights & External Flashes",
        "Live Streaming Equipment",
        "Stabilizers & Gimbals",
      ],
      "Gaming & Utility Accessories": [
        "Phone Coolers & Fans",
        "Gaming Triggers & Assist Buttons",
        "Stylus Pens & Accessories",
        "Screen Magnifiers",
        "Auto Clickers & Assist Tools",
      ],
      "Repair, Maintenance & Replacement": [
        "Replacement Parts",
        "Internal Components",
        "Repair Tool Kits",
        "Cleaning Kits & Brushes",
        "SIM Card Tools & Adapters",
        "Housing & Frames",
      ],
      "Decoration & Personalization": [
        "Phone Charms & Lanyards",
        "Back Stickers & Skins",
        "Dust Plugs",
        "Custom Phone Accessories",
      ],
      "Specialty & Smart Add-Ons": [
        "Signal Boosters & Antennas",
        "Wireless Display Receivers",
        "Anti-Loss Devices",
        "Phone Projectors",
      ],
    },

     "TABLETS": {
      "Tablet Devices": [
        "Android Tablets",
        "iPads",
        "Windows Tablets",
        "Educational Tablets",
      ],
      "Kids Tablets": [
        "Kids Tablets",
      ],
      "Tablet Accessories": [
        "Tablet Cases & Covers",
        "Tablet Keyboards",
        "Stylus Pens",
        "Screen Protectors",
        "Chargers & Cables",
      ],
      "Tablet Parts & Repairs": [
        "Screens & Displays",
        "Batteries",
        "Charging Ports",
        "Repair Tools",
      ],
    },

    "POWER SOLUTIONS": {
      "Generators": [
        "Petrol Generators",
        "Diesel Generators",
        "Gas Generators",
        "Portable Generators",
        "Industrial & Heavy-Duty Generators",
      ],
      "Solar & Renewable Energy": [
        "Solar Panels",
        "Solar Inverters",
        "Solar Batteries",
        "Solar Charge Controllers",
        "Solar Kits & Complete Systems",
        "Solar Accessories",
      ],
      "Inverters & Converter Systems": [
        "Inverters",
        "Hybrid Inverter Systems",
        "Voltage Converters",
        "Power Stabilizers",
      ],
      "Batteries & Energy Storage": [
        "Inverter Batteries",
        "Solar Batteries",
        "Lithium Batteries",
        "Deep Cycle Batteries",
        "Portable Power Stations",
        "Power Banks",
      ],
     "UPS & Power Backup": [
       "UPS Systems",
       "Mini UPS",
       "Surge Protectors",
       "Voltage Protectors",
      ],
     "Portable Power & Outdoor Energy": [
       "Portable Power Stations",
       "Power Banks",
       "Camping & Outdoor Power Solutions",
       ],
      "Power Accessories & Components": [
        "Power Cables & Connectors",
        "Battery Accessories",
        "Generator Accessories",
        "Solar Accessories",
        "Mounting & Installation Accessories",
        ],
    },

     "DIGITAL DEVICE": {
      "Wearable Digital Devices": [
        "Smartwatches",
        "Fitness trackers",
        "Smart bandsHealth & activity monitors",
      ],
      "Cameras & Imaging Devices": [
        "Digital cameras",
        "Action cameras",
        "Instant cameras",
        "Dash cameras",
        "Body cameras",
      ],
      "Audio Devices": [
        "Headphones",
        "Earphones/Earbuds",
        "Bluetooth speakers",
        "Portable music players",
        "Digital voice recorders",
      ],
      "Video & Media Devices": [
        "Streaming media players",
        "Set-top boxes",
        "Digital TV boxes",
        "Media playback devices",
      ],
     "Networking & Communication Devices": [
       "Modems",
       "Mobile hotspots",
       "Walkie-talkies",
       "Desk phones & intercom systems",
      ],
     "Digital Measurement & Control Devices": [
       "Digital thermometers",
       "Digital weighing scales",
       "Blood pressure monitors",
       "Pulse oximeters",
       "Laser distance meters",
       ],
      "Educational & Office Digital Devices": [
        "Scientific & graphing calculators",
        "Electronic dictionaries",
        "Digital translators",
        "Digital note-taking devices",
        "Presentation pointers",
        ],
       "Personal Safety & Tracking Devices": [
         "GPS trackers",
         "Anti-loss devices",
         "Personal alarms",
         "Dash & security recording devices",
        ],
    },

    "COMPUTER & ACCESSORIES": {
      "Computers & Workstations": [
        "Laptops & notebooks",
        "Desktops",
        "All-in-one computers",
        "Mini PCs",
        "Workstations",
        "Servers",
      ],
      "Monitors & Display Devices": [
        "Computer monitors",
        "Ultrawide monitors",
        "Professional & graphic monitors",
        "Portable monitors",
      ],
      "Computer Peripherals": [
        "Keyboards",
        "Mice & trackpads",
        "Webcams",
        "Microphones",
        "Headsets",
        "Speakers",
        "Graphics tablets",
      ],
      "Storage & Memory": [
        "External hard drives",
        "External SSDs",
        "USB flash drives",
        "Memory cards",
        "RAM",
      ],
     "Networking & Connectivity": [
       "Routers",
       "Modems",
       "MiFi & dongles",
       "Network switches",
       "Network cards & adapters",
      ],
     "Printers, Scanners & Office Machines": [
       "Printers",
       "Scanners",
       "Copiers",
       "Printer inks & toners, Cartridges",
       ],
      "Computer Accessories": [
        "Laptop bags & backpacks",
        "Sleeves & covers",
        "Laptop stands",
        "Cooling pads",
        "Cable organizers",
        "Screen privacy filters",
        ],
       "Power & Protection for Computers": [
         "UPS",
         "Surge protectors",
         "Voltage regulators",
         "Power strips",
        ],
       "Software & Digital Licenses": [
         "Operating systems",
         "Office & business software",
         "Antivirus & security software",
         "Utility softwar",
         ],
        "Projectors & Presentation Equipment": [
          "Projectors",
          "Projection screens",
          "Mounting brackets",
          "Projector remotes & accessories",
          ],
    },

    


  "SMART HOME DEVICES": {
      "Smart Hubs & Home Automation Controllers": [
        "Smart hubs & gateways",
        "Home automation controllers",
        "Zigbee / Z-Wave / Matter hubs",
      ],
      "Smart Security & Surveillance": [
        "Smart security cameras",
        "Smart alarm systems",
        "Motion sensors",
        "Smart sirens",
        "Video surveillance kits",
      ],
      "Smart Doorbells & Smart Locks": [
        "Video doorbells",
        "Smart door locks",
        "Smart access control systems",
      ],
      "Smart Lighting & Smart Switches": [
        "Smart bulbs",
        "Smart LED strips",
        "Smart wall switches",
        "Smart dimmers",
        "Smart lighting controllers",
      ],
     "Smart Plugs, Sockets & Power Control": [
       "Smart plugs",
       "Smart outlets",
       "Smart power strips",
       "Energy monitoring plugs",
      ],
     "Smart Climate & Environmental Control": [
       "Smart thermostats",
       "Smart air conditioners controllers",
       "Smart heaters controllers",
       "Smart humidifiers & dehumidifiers",
       "Smart air quality monitors",
       ],
      "Smart Sensors & Detectors": [
        "Motion sensors",
        "Door & window sensors",
        "Smoke detectors",
        "Gas leak detectors",
        "Water leak sensors",
        "Temperature & humidity sensors",
        ],
       "Smart Home Entertainment Control": [
         "Smart TV controllers",
         "Smart remotes",
         "Media automation devices",
         "Smart speaker",
        ],
       "Smart Appliances Controllers": [
         "Smart appliance controllers",
         "Smart plugs for appliances",
         "Smart kitchen & utility automation devices",
         ],
        "Smart Curtains, Blinds & Window Automation": [
          "Smart curtain motors",
          "Smart blinds controllers",
          "Smart window automation devices",
          ],
        "Smart Irrigation & Outdoor Automation": [
          "Smart irrigation controllers",
          "Smart garden automation",
          "Outdoor smart sensors",
          ],
         "Smart Home Accessories & Installation Kits": [
           "Mounts & brackets",
           "Installation kits",
           "Extension modules",
           "Smart home cables",
           ],
    },




  "GAMING & CONSOLES": {
      "Gaming Consoles": [
        "Home Gaming Consoles",
        "Handheld & Portable Consoles",
        "Retro & Classic Console",
      ],
      "Console Brands & Platforms": [
        "PlayStation",
        "Xbox",
        "Nintendo",
        "Other & Retro Platforms",
      ],
      "Video Games": [
        "Console Games",
        "Digital Game Cards & Codes",
        "Game Genres",
      ],
      "Gaming Controllers & Input Devices": [
        "Game Controllers & Gamepads",
        "Steering Wheels & Racing Controllers",
        "Joysticks & Arcade Sticks",
        "Motion Controllers",
      ],
     "Gaming Accessories": [
       "Power & Charging",
       "Cables & Adapters",
       "Cables & Adapters",
       "Storage & Memory",
       "Cooling & Performance Accessories",
       "Stands, Mounts & Docks",
       "Skins, Covers & Protective Gear",
       "Carrying Cases & Travel Bags",
      ],
     "Gaming Audio & Communication": [
       "Gaming Headsets",
       "Gaming Headphones",
       "Microphones",
       "Audio Adapters",
       ],
      "Gaming Displays & Visual Accessories": [
        "Gaming Monitors",
        "Console Screens & Portable Displays",
        "VR Headsets & Accessories",
        ],
       "PC Gaming": [
         "PC Game Controllers",
         "PC Gaming Accessories",
         "PC Gaming Interfaces",
         "Cross-Platform Gaming Devices",
        ],
       "Console Parts & Repairs": [
         "Replacement Parts",
         "Repair Kits & Tools",
         "Mods & Customization Parts",
         ],
    },


},
  "Home, Living & Industrial": {
    "HOME & KITCHEN": {
"Home Appliances": {
"Large Home Appliances": [
"Refrigerators & Freezers",
"Air Conditioners & Coolers",
"Washing Machines & Dryers",
"Cookers, Ovens & Hobs",
"Water Dispensers",
"Dishwashers"
],
"Small Home Appliances": [
"Electric Kettles",
"Irons & Steamers",
"Blenders & Mixers",
"Juicers & Food Processors",
"Rice Cookers & Yam Pounders",
"Toasters & Sandwich Makers",
"Coffee & Tea Appliances",
"Ice Makers"
],
"Cleaning & Air Care Appliances": [
"Vacuum Cleaners",
"Floor Care Machines",
"Air Purifiers & Humidifiers",
"Fans & Heaters"
]
},

"Kitchen & Dining": {
"Cookware & Bakeware": [
"Pots & Pans",
"Pressure Cookers",
"Baking Trays & Moulds"
],
"Kitchen Utensils & Tools": [
"Knives & Cutlery",
"Cooking Utensils",
"Graters, Peelers & Choppers"
],
"Dining & Serving": [
"Plates & Bowls",
"Cups & Glassware",
"Serving Trays & Dispensers"
],
"Kitchen Storage & Organization": [
"Food Containers",
"Racks & Holders",
"Spice Organizers"
]
},

"Home Essentials & Living": {
"Bedding & Furnishings": [
"Bed Sheets & Pillows",
"Blankets & Throws",
"Mattress Pads"
],
"Curtains, Rugs & Carpets": [
"Curtains & Blinds",
"Area Rugs & Door Mats"
],
"Home Decor": [
"Wall Art & Mirrors",
"Clocks & Candles",
"Vases & Decorative Plants"
],
"Lighting": [
"Lamps & Shades",
"Decorative & Solar Lights"
]
},

"Storage & Organization": [
"Storage Boxes & Baskets",
"Wardrobe Organizers",
"Shelving & Racks",
"Laundry Baskets"
],

"Bathroom & Laundry": {
"Bathroom Accessories": [
"Towel Racks & Holders",
"Shower Accessories",
"Bathroom Storage"
],
"Laundry & Cleaning": [
"Laundry Supplies",
"Buckets, Mops & Brushes",
"Drying Racks"
]
},

"Household Cleaning & Care": [
"Cleaning Supplies",
"Insect & Pest Control",
"Household Batteries",
"Lighters & Utility Tools"
],

"Health, Personal Care & Wellness": {
"Personal Care Devices": [
"Electric Massagers",
"Oral Care Devices",
"Hair Care Appliances"
],
"Health & Wellness": [
"Home Health Monitors",
"Massage & Relaxation Tools",
"Mobility & Daily Living Aids"
],
"Hygiene & Care Products": [
"Bathing Accessories",
"Vision & Ear Care",
"Foot Care"
]
},

"Kids Home & Family Living": [
"Kids Bedding",
"Kids Bathroom Accessories",
"Kids Room Decor",
"Kids Storage"
],

"Arts, Crafts & Home Creativity": [
"Arts & Craft Supplies",
"Sewing & Knitting",
"Party & Event Decorations",
"Gift Wrapping Supplies"
],

"Outdoor & Home Utility": [
"Outdoor Furniture",
"Garden & Balcony Items",
"Household Tools"
]
},

"FURNITURE": {
      "Living Room Furniture": [
        "Sofas & Sectionals",
        "Armchairs & Recliners",
        "TV Stands & Media Units",
        "Coffee Tables",
        "Side & Console Tables",
        "Living Room Storage Units",
        "Living Room Furniture Sets",
      ],
      "Bedroom Furniture": [
        "Beds & Bed Frames",
        "Mattresses",
        "Wardrobes & Closets",
        "Dressers & Chest of Drawers",
        "Nightstands & Bedside Tables",
        "Bedroom Furniture Sets",
      ],
      "Dining Room & Kitchen Furniture": [
        "Dining Tables",
        "Dining Chairs",
        "Dining Table Sets",
        "Bar Stools & Counter Stools",
        "Kitchen Islands & Carts",
        "Buffets & Sideboard",
      ],
      "Home Office Furniture": [
        "Office Desks & Workstations",
        "Office Chairs",
        "Bookcases & Shelving",
        "Filing Cabinets",
        "Office Storage Units",
        "Office Furniture Sets",
        "Room Dividers & Partitions",
      ],
      "Kids & Baby Furniture": [
        "Kids Beds & Cribs",
        "Study Tables & Chairs",
        "Kids Wardrobes & Storage",
        "Kids Furniture Sets",
        "Toy Storage Units",
      ],
      "Outdoor & Patio Furniture": [
        "Outdoor Seating",
        "Outdoor Tables",
        "Patio Furniture Sets",
        "Hammocks & Swings",
        "Umbrellas & Canopies",
        "Outdoor Storage",
        "Planters & Plant Stands",
      ],
      "Bathroom Furniture": [
        "Bathroom Cabinets",
        "Vanity Units",
        "Bathroom Storage Shelves",
        "Over-the-Toilet Storage",
      ],
      "Entryway & Accent Furniture": [
        "Console Tables",
        "Entryway Benches",
        "Shoe Racks & Cabinets",
        "Accent Chairs",
        "Decorative Cabinets",
      ],
      "Storage & Organization Furniture": [
        "Storage Cabinets",
        "Shelving Units",
        "Wardrobe Systems",
        "Multi-Use Storage Furniture",
      ],
      "Commercial & Hospitality Furniture": [
        "Restaurant & Bar Furniture",
        "Hotel Furniture",
        "Salon & Spa Furniture",
        "Institutional Furniture",
        "Office Bulk Set",
      ],
      "Furniture Parts & Accessories": [
        "Replacement Parts",
        "Furniture Hardware",
        "Table Legs & Components",
        "Protective Covers",
      ],
    },

    "HOME TEXILES": {
      "Bedding & Bed Linen": [
        "Duvet Covers & Sets",
        "Comforters & Quilts",
        "Bed Sheets",
        "Sheet Sets with Pillowcases",
        "Pillowcases & Shams",
        "Bed Skirts",
        "Mattress Pads & Toppers",
        "Mosquito Nets",
        "Bedding Accessories",
        "Customized Bedding",
      ],
      "Pillows & Cushions": [
        "Bed Pillows",
        "Decorative & Throw Pillows",
        "Pillow Inserts",
        "Cushion Covers",
        "Support & Positioning Pillows",
        "Lumbar Pillows",
        "Chair Cushions",
        "Customized Cushions",
      ],
      "Curtains & Window Treatments": [
        "Curtains & Drapes",
        "Sheer Panels",
        "Blackout Curtains",
        "Door Curtains",
        "Kitchen Curtains",
        "Valances",
        "Curtain Tracks & Accessories",
        "Window Screens",
        "Window Films & Stickers",
      ],
      "Rugs, Carpets & Floor Mats": [
        "Area Rugs",
        "Runner Rugs",
        "Kitchen Mats",
        "Bathroom & Laundry Mats",
        "Door Mats",
        "Carpet Padding & Grippers",
        "Customized Rugs & Mats",
      ],
      "Sofa & Furniture Covers": [
        "Sofa Covers",
        "Chair Covers",
        "Recliner Slipcovers",
        "Futon Covers",
        "Armrest Covers",
        "Outdoor Furniture Covers",
      ],
      "Blankets & Throws": [
        "Bed Blankets",
        "Sofa Throws",
        "Wearable Blankets",
        "Towel Blankets",
        "Customized Throws",
      ],
      "Towels & Bath Linen": [
        "Bath Towels",
        "Hand Towels",
        "Bath Sheets",
        "Beach Towels",
        "Towel Sets",
        "Hair Drying Caps",
      ],
      "Kitchen & Table Linen": [
        "Tablecloths",
        "Table Runners",
        "Placemats",
        "Table Napkins",
        "Dish Towels & Cloths",
        "Aprons",
      ],
      "Wall & Decorative Textiles": [
        "Fabric Wall Hangings",
        "Decorative Fabric Panels",
        "Themed Textile Decor",
        "Seasonal Textile Decorations",
      ],
      "Seasonal & Occasion Textiles": [
        "Christmas Textiles",
        "Ramadan Textiles",
        "Valentine’s Day Decor",
        "Party & Event Textiles",
        "Wedding Textile Decor",
      ],
    },

    



"HOME IMPROVEMENT & TOOLS": {
      "Hand Tools": [
        "Hammers & Mallets",
        "Screwdrivers & Sets",
        "Pliers & Cutters",
        "Wrenches & Spanners",
        "Tool Kits",
        "Clamps & Vices",
        "Utility Knives",
      ],
      "Power Tools": [
        "Drills & Drivers",
        "Grinders",
        "Saws",
        "Sanders",
        "Heat Guns",
        "Electric Screwdrivers",
        "Power Tool Sets",
        "Power Tool Accessories",
        "Drill Bits",
        "Saw Blades",
        "Grinding Discs",
        "Batteries & Chargers",
        "Replacement Parts",
      ],
      "Measuring & Layout Tools": [
        "Tape Measures",
        "Laser Levels",
        "Spirit Levels",
        "Measuring Wheels",
        "Angle Finders",
        "Inspection Tools",
      ],
      "Electrical Supplies": [
        "Switches & Sockets",
        "Wires & Cables",
        "Circuit Breakers",
        "Power Outlets & Extensions",
        "LED Strip Lights",
        "Light Bulbs",
        "Power Protection Devices",
      ],
      "Lighting & Ceiling Fixtures": [
        "Indoor Lighting Fixtures",
        "Outdoor Lighting",
        "Ceiling Fans",
        "Work Lights",
        "Flood Lights",
        "Holiday Lighting",
      ],
      "Plumbing & Water Systems": [
        "Pipes & Fittings",
        "Faucets & Shower Heads",
        "Drainage Systems",
        "Water Heaters",
        "Pumps",
        "Water Filtration Systems",
      ],
      "Building Materials & Hardware": [
        "Doors & Windows",
        "Flooring & Accessories",
        "Tiles & Wall Panels",
        "Wood & Lumber",
        "Adhesives & Sealants",
        "Fasteners",
        "Cabinet Hardware",
        "Brackets & Connectors",
      ],
      "Painting & Wall Treatment": [
        "Paint Tools & Rollers",
        "Spray Guns",
        "Wallpaper",
        "Wall Stickers & Murals",
        "Surface Preparation Tools",
      ],
      "Welding & Soldering": [
        "Welding Machines",
        "Soldering Irons",
        "Welding Accessories",
        "Protective Welding Gear",
      ],
      "Safety & Protective Equipment": [
        "Helmets & Hard Hats",
        "Safety Gloves",
        "Protective Glasses",
        "Fire Safety Equipment",
        "Road Safety Equipment",
        "Workwear Protection",
      ],
     "Security & Surveillance": [
       "Surveillance Cameras",
       "Alarm Systems",
       "Motion Sensors",
       "Access Control Systems",
       "Intercoms & Doorbells",
        ],
       "HVAC & Climate Systems": [
         "Air Ventilation Systems",
         "Insulation Materials",
         "Climate Control Devices",
         "Heating Components",
          ],
         "Garden & Outdoor Tools": [
           "Gardening Tools",
           "Lawn Equipment",
           "Outdoor Power Tools",
           "Landscaping Tools",
           ],
          "Storage & Tool Organization": [
            "Tool Boxes",
            "Tool Cabinets",
            "Wall Storage Systems",
            "Garage Storage",
            ],
           "Appliance Parts & Installation Supplies": [
            "Appliance Installation Kits",
            "Replacement Parts",
            "Mounting Hardware",
            ],
          },

          



"AGRICULTURE": {
      "Seeds & Planting Materials": [
        "Crop Seeds",
        "Vegetable Seeds",
        "Fruit Seeds",
        "Grain & Cereal Seeds",
        "Grass & Pasture Seeds",
        "Seedlings & Saplings",
      ],
      "Fertilizers & Soil Care": [
        "Organic Fertilizers",
        "Chemical Fertilizers",
        "Compost & Manure",
        "Soil Conditioners",
        "Soil Testing Kits",
        "Growth Enhancers",
      ],
      "Crop Protection": [
        "Pesticides",
        "Herbicides",
        "Fungicides",
        "Insecticides",
        "Rodent Control",
        "Sprayers & Application Equipment",
      ],
      "Farm Machinery & Equipment": [
        "Tractors",
        "Ploughs & Tillers",
        "Irrigation Pumps",
        "Harvesting Machines",
        "Planting Machines",
        "Processing Equipment",
      ],
      "Irrigation & Water Management": [
        "Drip Irrigation Systems",
        "Sprinkler Systems",
        "Water Tanks",
        "Water Pipes & Fittings",
        "Borehole & Pump Accessories",
      ],
      "Hand Tools & Small Farm Tools": [
        "Hoes & Cutlasses",
        "Shovels & Spades",
        "Rakes",
        "Pruning Tools",
        "Wheelbarrows",
      ],
      "Poultry Farming": [
        "Day-Old Chicks",
        "Poultry Feed",
        "Poultry Drinkers & Feeders",
        "Incubators",
        "Brooders & Heating Equipment",
        "Poultry Cages",
      ],
      "Livestock Farming": [
        "Animal Feed",
        "Cattle Equipment",
        "Goat & Sheep Supplies",
        "Pig Farming Supplies",
        "Animal Health Products",
      ],
      "Greenhouse & Controlled Farming": [
        "Greenhouse Structures",
        "Shade Nets",
        "Hydroponic Systems",
        "Seed Trays & Grow Bags",
        "Climate Control Equipment",
      ],
      " Harvesting & Post-Harvest Supplies": [
        "Harvesting Tools",
        "Crop Storage Bags",
        "Grain Storage Equipment",
        "Drying Equipment",
        "Weighing Scales",
      ],
     "Farm Safety & Protective Gear": [
       "Farm Gloves",
       "Boots",
       "Protective Clothing",
       "Chemical Handling Gear",
        ],
    },

    
"PATIO LAWN & GARDEN": {
      "Plants, Seeds & Growing": [
        "Live Plants",
        "Seeds & Bulbs",
        "Seedlings",
        "Artificial Plants",
        "Greenhouse Supplies",
        "Grow Lights",
      ],
      "Planters & Plant Care": [
        "Plant Pots & Containers",
        "Hanging Planters",
        "Plant Stands",
        "Plant Supports",
        "Garden Soil & Treatments",
        "Fertilizers",
      ],
      "Watering & Irrigation": [
        "Garden Hoses",
        "Watering Cans",
        "Sprinklers",
        "Drip Irrigation Kits",
        "Water Timers",
      ],
      "Gardening Tools & Equipment": [
        "Hand Garden Tools",
        "Pruners & Shears",
        "Rakes & Shovels",
        "Lawn Mowers",
        "Outdoor Power Tools",
        "Garden Tool Sets",
      ],
      "Irrigation & Water Management": [
        "Drip Irrigation Systems",
        "Sprinkler Systems",
        "Water Tanks",
        "Water Pipes & Fittings",
        "Borehole & Pump Accessories",
      ],
      "Outdoor Structures & Shade": [
        "Gazebos",
        "Pergolas",
        "Canopies",
        "Greenhouse Structures",
        "Garden Sheds",
      ],
      "Outdoor Lighting": [
        "Solar Garden Lights",
        "Pathway Lights",
        "String & Decorative Lights",
        "Landscape Lighting",
        "Outdoor Wall Lights",
      ],
      "Outdoor Decor & Ornaments": [
        "Garden Sculptures",
        "Decorative Stakes",
        "Yard Signs",
        "Outdoor Wall Art",
        "Water Fountains",
        "Ponds & Water Features",
      ],
      "Outdoor Heating & Cooling": [
        "Patio Heaters",
        "Fire Pits",
        "Outdoor Fans",
        "Outdoor Cooling Systems",
      ],
      " Grills & Outdoor Cooking": [
        "BBQ Grills",
        "Smokers",
        "Outdoor Cooking Accessories",
        "Picnic & Outdoor Dining Gear",
      ],
     "Pools, Spas & Water Recreation": [
       "Swimming Pools",
       "Hot Tubs",
       "Pool Cleaning Equipment",
       "Pool Covers",
       "Pool Chemicals",
        ],
       "Backyard Animals & Wildlife Care": [
         "Bird Feeders",
         "Bird Houses",
         "Beekeeping Supplies",
         "Backyard Livestock Supplies",
          ],
        "Pest & Weed Control": [
          "Garden Pest Control",
          "Weed Killers",
          "Rodent Control",
          "Mosquito Control",
          ],
        "Outdoor Storage & Utility": [
          "Outdoor Storage Boxes",
          "Deck Storage",
          "Firewood Racks",
          "Outdoor Tool Storage",
           ],
         "Generators & Portable Power": [
          "Portable Generators",
          "Outdoor Extension Cords",
          "Power Stations",
          ],
        "Seasonal & Holiday Outdoor Decor": [
          "Christmas Outdoor Decor",
          "Halloween Yard Decor",
          "Festive Garden Lights",
          "Outdoor Party Decor",
          ],
    },
  },
  "Beauty, Health & Personal care": {
  "Beauty & Skin Care": {
    Makeup: {
      "Face Makeup": [
        "Foundation",
        "Concealer",
        "Powder",
      ],
      "Eye Makeup": [
        "Mascara",
        "Eyeliner",
        "Eyeshadow",
      ],
      "Lip Makeup": [
        "Lipstick",
        "Gloss",
        "Liner",
      ],
      "Body & Special Effect Makeup": [],
      "Makeup Sets & Kits": [],
      "Makeup Removers": [],
    },

    "Makeup Tools & Accessories": [
      "Makeup Brushes & Sponges",
      "False Eyelashes & Adhesives",
      "Makeup Mirrors",
      "Makeup Bags & Organizers",
      "Refillable Containers",
    ],

    Skincare: [
      "Face & Neck Care",
      "Body Care",
      "Eye & Lip Care",
      "Serums & Treatments",
      "Sun Care & Tanning",
      "Skincare Sets",
    ],

    "Nail, Hand & Foot Care": [
      "Nail Polish & Gel Polish",
      "Nail Art & Stickers",
      "Nail Tools & Equipment",
      "Press-On Nails",
      "Nail Treatment Products",
      "Hand & Foot Care",
    ],

    "Tattoo & Body Art": [
      "Tattoo Machines & Kits",
      "Tattoo Inks & Needles",
      "Piercing Supplies",
      "Temporary Tattoos",
      "Tattoo Care Products",
    ],
  },

  "Hair Care": {
    "Hair Cleansing & Treatment": [
      "Shampoo & Conditioner",
      "Hair Masks",
      "Scalp Treatments",
      "Hair Oils & Serums",
    ],

    "Hair Styling": [
      "Styling Products",
      "Hair Color & Dye",
      "Perms & Relaxers",
    ],

    "Hair Tools": [
      "Hair Dryers",
      "Straighteners",
      "Curlers",
      "Hot Air Brushes",
      "Hair Cutting Tools",
      "Electric Clippers & Trimmers",
    ],

    "Wigs & Extensions": [
      "Wigs",
      "Hair Extensions",
      "Wig Accessories",
    ],

    "Hair Accessories": [
      "Combs & Brushes",
      "Hair Clips & Bands",
      "Rollers & Braiders",
    ],
  },

  "Health Products": {
    "Vitamins & Supplements": [
      "Multivitamins",
      "Herbal Supplements",
      "Immune Support",
     ],
    "Medical Supplies": [
     "First Aid Supplies",
     "Mobility Aids",
     "Braces & Supports",
     "Medical Equipment",
    ],
    "Health Monitoring": [
      "Thermometers",
      "Blood Pressure Monitors",
      "Glucose Monitors",
      "Body Weight Scales",
   ],
    "Rehabilitation & Therapy": [
      "Physical Therapy Equipment",
      "Support Braces",
      "Recovery Tools",
    ],
    "Adult Wellness": [
      "Intimate Wellness Products",
      "Protection Products",
    ],
  },

  "Personal Care Devices": {
    "Grooming Appliances": [
      "Electric Shavers",
      "Beard Trimmers",
      "Epilators",
      "Hair Removal Devices",
    ],
    "Skincare Devices": [
      "Facial Cleansing Brushes",
      "LED Therapy Devices",
      "Skin Analyzers",
   ],
    "Massage & Relaxation Devices": [
      "Electric Massagers",
      "Foot Spas",
      "Massage Chairs & Cushions",
    ],
    "Oral Care Devices": [
     "Electric Massagers",
     "Foot Spas",
     "Massage Chairs & Cushions",
    ],
},

   "Fragrances": {
    "Perfumes & Colognes": [
      "Men's Fragrances",
      "Women's Fragrances",
      "Unisex Fragrances",
     ],
    "Body Fragrance": [
       "Deodorants",
       "Body Sprays",
     ],
    "Aromatherapy & Home Scents": [
      "Essential Oils",
      "Diffusers",
      "Scented Candles",
  ],
},

  "Household Essentials": {
    "Bath & Shower": [
      "Soaps & Body Wash",
      "Bath Accessories",
      "Shower Sets",
     ],
    "Oral Care": [
       "Toothpaste",
       "Toothbrushes",
       "Mouthwash",
       "Floss & Whitening Kits",
     ],
    "Feminine & Intimate Care": [
       "Feminine Hygiene Products",
       "Intimate Wash",
       "Care Accessories",
     ],
    "Daily Hygiene": [
       "Face Masks",
       "Cotton Pads & Swabs",
       "Wipes",
       "Tissues & Paper Towels",
       "Hand Sanitizers",
  ],
},
},
  "Food, Drinks & Groceries": {
    "Food & Groceries": {
  "Fresh Produce": [
   "Fruits",
   "Vegetables",
   "Salad & Greens",
   "Fresh Herbs",
   "Mushrooms",
   ],
   "Meat, Poultry & Seafood": [
     "Beef & Veal",
     "Chicken",
     "Pork",
     "Turkey",
     "Ground Meat & Burgers",
     "Steaks & Chops",
     "Fish",
     "Shrimp & Shellfish",
     "Smoked & Cured Fish",
    ],
   "Dairy & Eggs": [
     "Milk",
     "Yogurt",
     "Cheese",
     "Butter & Margarine",
     "Eggs",
    ],
   "Bakery & Bread": [
     "Bread & Rolls",
     "Specialty Breads & Wraps",
     "Cakes & Pastries",
     "Gluten-Free Bakery",
    ],
  "Pantry Staples": [
     "Rice & Grains",
     "Pasta & Noodles",
     "Flour & Baking Ingredients",
     "Beans & Lentils",
     "Breakfast Cereals",
     "Spices & Seasonings",
     "Sauces & Condiments",
     "Oils & Vinegars",
     "Sugar & Sweeteners",
     "Jams & Spreads",
    ],
  "Canned, Jarred & Packaged Foods": [
     "Canned Vegetables & Fruits",
     "Canned Meat & Meals",
     "Canned Fish",
     "Packaged Ready Foods",
    ],
  "Frozen Foods": [
     "Frozen Meat & Seafood",
     "Frozen Vegetables & Fruits",
     "Frozen Meals",
     "Frozen Snacks",
     "Ice Cream & Desserts",
   ],
  "Ready Meals & Deli": [
     "Prepared Main Courses",
     "Sandwiches & Wraps",
     "Soups & Broths",
     "Salads & Dips",
     "Savory Pies & Pastries",
     "Deli Slices & Ham",
     "Sausages",
   ],
  "Snacks & Confectionery": [
     "Chips & Pretzels",
     "Nuts & Seeds",
     "Candy & Chocolate",
     "Meat Snacks",
  ],
},
 "Drinks & Beverages": {
   "Water": [
     "Still Water",
     "Sparkling Water",
     "Flavored Water",
  ],
   "Soft Drinks & Energy": [
     "Soft Drinks",
     "Energy Drinks",
     "Sports Drinks",
  ],
   "Juice & Plant-Based Drinks": [
     "Fruit Juices",
     "Nectars",
     "Smoothies",
     "Plant-Based Milk",
   ],
   "Tea": [
     "Black Tea",
     "Green Tea",
     "Herbal & Fruit Tea",
     "Iced & Ready-to-Drink Tea",
   ],
  "Coffee": [
     "Ground Coffee",
     "Whole Bean Coffee",
     "Instant Coffee",
     "Capsule Coffee",
     "Ready-to-Drink Coffee",
   ],
 "Dairy Beverages": [
     "Flavored Milk",
     "Yogurt Drinks",
   ],
},
  "Alcoholic Beverages": {
    "Beer & Cider": [
     "Beer",
     "Craft Beer",
     "Cider",
    ],
   "Wine & Sparkling": [
     "Red Wine",
     "White Wine",
     "Rosé",
     "Champagne & Sparkling Wine",
   ],
    "Spirits & Liquors": [
     "Whiskey",
     "Vodka",
     "Gin",
     "Rum",
     "Tequila",
     "Liqueurs",
   ],
   "Ready-to-Drink Alcohol": [
     "Coolers",
     "Cocktails",
     "Premixed Drinks",
  ],
},
  },
  "Baby Kids & Toys": {
    "Baby & Maternity": {
    "Maternity Clothing": [
     "Maternity Dresses",
     "Maternity Tops",
     "Maternity Pants & Leggings",
     "Nursing Wear",
     "Maternity Intimates",
    ],
    "Maternity Care": [
     "Stretch Mark Care",
     "Postpartum Care",
     "Nursing Pads",
     "Breast Pumps",
     "Maternity Vitamins",
   ],
   "Pregnancy Support": [
     "Belly Support Belts",
     "Maternity Pillows",
     "Compression Wear",
  ],
},
    "Baby Essentials": {
     "Feeding & Nursing": [
     "Baby Bottles",
     "Bibs & Burp Cloths",
     "Pacifiers & Teethers",
     "High Chairs",
     "Baby Food Storage",
     "Bottle Sterilizers & Warmers",
   ],
   "Diapering & Potty": [
     "Disposable Diapers",
     "Cloth Diapers",
     "Baby Wipes",
     "Diaper Bags",
     "Changing Mats",
     "Potty Seats",
   ],
   "Baby Bath & Grooming": [
     "Baby Body Wash",
     "Baby Lotion & Cream",
     "Bath Tubs",
     "Towels & Washcloths",
     "Grooming Kits",
  ],
   "Baby Health & Safety": [
     "Baby Monitors",
     "Safety Gates",
     "Corner Guards",
     "Mosquito Nets",
     "First Aid Kits",
   ],
   "Nursery & Baby Gear": [
     "Cribs & Bassinets",
     "Baby Bedding",
     "Baby Storage",
     "Strollers",
     "Car Seats",
     "Baby Carriers",
   ],
    "Baby Clothing & Shoes": [
     "Bodysuits",
     "Sleepwear",
     "Baby Shoes",
     "Baby Hats & Socks",
   ],
},
  "Toys & Games": {
    "Indoor Toys": [
     "Dolls & Action Figures",
     "Toy Vehicles",
     "Plush Toys",
     "Playsets",
   ],
   "Outdoor Toys": [
     "Ride-On Toys",
     "Scooters",
     "Sports Play Equipment",
  ],
   "Games": [
     "Board Games",
     "Card Games",
     "Family Games",
   ],
   "Electronic Toys": [
     "Sound Toys",
     "Interactive Toys",
     "Toy Gadgets",
   ],
    "Party & Novelty Toys": [
     "Party Favors",
     "Seasonal Toys",
   ],
},
  "Educational Toys": {
   "Early Learning (0–5)": [
     "Alphabet Toys",
     "Shape & Color Toys",
     "Montessori Toys",
   ],
   "STEM & Science": [
     "Robotics Kits",
     "Coding Toys",
     "Science Experiment Kits",
   ],
   "Learning Games": [
     "Educational Board Games",
     "Math Games",
     "Language Games",
   ],
   "Arts, Craft & Creativity": [
     "Drawing Kits",
     "Craft Kits",
     "DIY Projects",
   ],
    "School Learning Aids": [
     "Flashcards",
     "Educational Charts",
     "Learning Tablets",
   ],
},
  },
  "Sports, Outdoor & Lifestyle": {
    "Sport & Fitness Equipment": {
   "Cardio Training Equipment": [
     "Treadmills",
     "Exercise Bikes",
     "Elliptical Machines",
     "Rowing Machines",
     "Step Machines",
   ],
  "Strength Training Equipment": [
     "Dumbbells",
     "Barbells & Weight Plates",
     "Kettlebells",
     "Resistance Machines",
     "Benches & Racks",
     "Core & Ab Trainers",
  ],
   "Functional & Home Fitness": [
     "Resistance Bands",
     "Jump Ropes",
     "Exercise Mats",
     "Balance Trainers",
     "Agility Ladders",
  ],
   "Combat & Martial Arts": [
     "Boxing Gloves",
     "Punching Bags",
     "MMA Gear",
     "Protective Guards",
   ],
  "Team Sports Equipment": [
     "Field & Court Sports",
     "Football Equipment",
     "Basketball Equipment",
     "Volleyball Equipment",
     "Handball Equipment",
     "Racquet Sports",
     "Tennis Equipment",
     "Badminton Equipment",
     "Table Tennis Equipment",
     "Squash Gear",
   ],
   "Water Sports Equipment": [
     "Swimming Gear",
     "Diving & Snorkeling Gear",
     "Kayaking Equipment",
     "Surfing Equipment",
   ],
   "Cycling Equipment": [
     "Bicycles",
     "Bike Parts",
     "Cycling Helmets",
     "Cycling Tools & Maintenance",
   ],
    "Golf Equipment": [
     "Golf Clubs",
     "Golf Balls",
     "Golf Bags",
     "Golf Training Aids",
   ],
   "Winter Sports Equipment": [
     "Skis",
     "Snowboards",
     "Sleds",
     "Winter Protective Gear",
   ],
   "Skating & Rolling Sports": [
     "Roller Skates",
     "Skateboards",
     "Scooters",
     "Protective Pads & Helmets",
   ],
   "Sports Recovery & Medicine": [
     "Braces & Supports",
     "Foam Rollers",
     "Ice Packs",
     "Muscle Therapy Tools",
    ],
},
  "Outdoor & Camping Gear": {
   "Camping Shelter & Sleeping": [
     "Tents",
     "Sleeping Bags",
     "Camping Beds",
     "Camping Chairs & Tables",
   ],
   "Camp Kitchen & Picnic": [
     "Portable Stoves",
    "Camping Cookware",
     "Cooler Boxes",
     "Picnic Sets",
   ],
    "Hiking & Climbing": [
     "Backpacks",
     "Climbing Ropes",
     "Carabiners",
     "Trekking Poles",
   ],
    "Survival & Tactical Gear": [
     "Survival Kits",
     "Multi-Tools",
     "Tactical Flashlights",
     "Compasses",
     "Emergency Gear",
   ],
   "Hunting & Fishing Gear": [
     "Fishing",
     "Fishing Rods",
     "Reels",
     "Tackle & Lures",
     "Tackle Boxes",
     "Hunting",
     "Hunting Knives",
     "Archery Equipment",
     "Decoys & Calls",
     "Hunting Optics",
  ],
   "Boating & Marine": [
     "Boat Accessories",
     "Life Jackets",
     "Marine Safety Gear",
   ],
   "Outdoor Lighting & Power": [
     "Camping Lanterns",
     "Headlamps",
     "Portable Power Stations",
   ],
    "Outdoor Games & Backyard Recreation": [
     "Billiards",
     "Dartboards",
     "Outdoor Play Equipment",
     "Game Room Equipment",
  ],
},
  },
  "Automotive & Mobility": {},
  "Office, Business & Education": {},
};