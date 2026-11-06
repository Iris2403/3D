"""Generates theme/templates/*.json and config/settings_data.json from verified KUKI content.

All copy, prices, product names, addresses and FAQ answers below were taken verbatim from the
live kukiworld.com theme (November 2026). Placeholder or copy-pasted descriptions were dropped
rather than guessed. Merchants can edit everything afterwards in the Shopify theme editor.
Run: python3 scripts/gen-templates.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "theme"

# --- Menu (name, category, price, verified description or "", asset) -------------------------
MENU = [
    ("Classic Kuki", "cookies", "3.60", "French butter, chocolate chunks and a touch of sea salt.", "m-classic-kuki"),
    ("Double Chocolate Kuki", "cookies", "3.80", "French butter, dark and milk chocolate, finished with sea salt.", "m-double-chocolate-kuki"),
    ("Belgian Kuki", "cookies", "4.20", "French butter, handmade biscuit praline and white chocolate.", "m-belgian-kuki"),
    ("Hazelnut Kuki", "cookies", "4.70", "French butter, handmade gianduja, caramel and hazelnut.", "m-hazelnut-kuki"),
    ("Lemon Kuki", "cookies", "4.20", "", "m-lemon-kuki"),
    ("Tiramisu Kuki", "cookies", "4.80", "French butter, intense coffee ganache, mascarpone cream and cocoa.", "m-tiramisu-kuki"),
    ("Kuki Dough Cheesecake", "cookies", "4.90", "", "m-kuki-dough-cheesecake"),
    ("Fistiki Jam Kuki", "cookies", "5.70", "", "m-fistiki-jam-kuki"),
    ("Strawberry Cloud", "cookies", "4.80", "", "m-strawberry-cloud"),
    ("Brookie", "cookies", "6.30", "Our iconic brookie — fudgy brownie meets the signature cookie.", "m-brookie"),
    ("Belgian Brookie & Cream", "cream", "8.20", "Kuki's & Cream Belgian-style dessert cup with rich chocolate layers.", "m-belgian-brookie-cream"),
    ("Pistachio Brookie & Cream", "cream", "9.00", "Creamy pistachio layers with a soft Kuki dessert base.", "m-pistachio-brookie-cream"),
    ("Hazelnut Brookie & Cream", "cream", "8.80", "Hazelnut cream, biscuit crunch, and a smooth Kuki finish.", "m-hazelnut-brookie-cream"),
    ("Caramel Brookie & Cream", "cream", "8.80", "Silky caramel cream layered with the signature Kuki crumble.", "m-caramel-brookie-cream"),
    ("Kuki Doh", "cream", "6.70", "Soft cookie dough cream with playful Kuki texture in every spoon.", "m-kuki-doh"),
    ("Brookie & Cream", "cream", "6.30", "", "m-brookie-cream"),
    ("Kuki Roll", "rolls", "4.70", "", "m-kuki-roll"),
    ("Kuki Roll Salted Caramel", "rolls", "5.60", "", "m-kuki-roll-salted-caramel"),
    ("Kuki Roll Belgian", "rolls", "6.20", "", "m-kuki-roll-belgian"),
    ("Kuki Roll Fistiki", "rolls", "6.70", "", "m-kuki-roll-fistiki"),
    ("Freddo Espresso", "coffee", "2.50", "Double shot of espresso over ice. Bold and refreshing.", "m-freddo-espresso"),
    ("Cappuccino", "coffee", "2.40", "Espresso topped with steamed milk and velvety foam.", "m-cappuccino"),
    ("Flat White", "coffee", "2.70", "Smooth espresso with silky micro-foam milk.", "m-flat-white"),
    ("Espresso", "coffee", "2.20", "", "m-espresso"),
    ("Cappuccino Latte", "coffee", "2.60", "", "m-cappuccino-latte"),
    ("Espresso Macchiato", "coffee", "2.60", "", "m-espresso-macchiato"),
    ("Freddo Cappuccino", "coffee", "2.60", "", "m-freddo-cappuccino"),
    ("Salted Caramel Hot Chocolate", "hot_chocolate", "3.70", "Warm milk chocolate with handmade salted caramel.", "m-salted-caramel-hot-chocolate"),
]

MENU_NOTE = (
    "Στο KUKI δίνουμε ιδιαίτερη σημασία στην ποιότητα, χρησιμοποιώντας προσεκτικά επιλεγμένες πρώτες ύλες, "
    "premium σοκολάτες και γαλλικό βούτυρο. Τα cookies μας ψήνονται καθημερινά στα καταστήματά μας, ώστε να "
    "απολαμβάνονται φρεσκοψημένα, με τη χαρακτηριστική υφή και γεύση τους. Στο πλαίσιο της διαδικασίας παραγωγής "
    "και συντήρησης, τα cookies και οι πραλίνες μας διατηρούνται ως κατεψυγμένα προϊόντα, σε ελεγχόμενες συνθήκες, "
    "μέχρι την τελική παρασκευή και το σερβίρισμά τους."
)

# --- Stores: exact Google Maps queries from the previous site; lat/lng are APPROXIMATE --------
STORES = [
    ("Ilion", "Athens · West", "Κωλέττη 11", "Ίλιον", "Κωλέττη 11, Ίλιον, Αθήνα", "38.0335", "23.7035"),
    ("Kypseli", "Athens · Central", "Ιωάννου Δροσοπούλου 93", "Κυψέλη", "Ιωάννου Δροσοπούλου 93, Κυψέλη, Αθήνα", "38.0030", "23.7385"),
    ("Panormou", "Athens · North", "Αλέξη Παυλή 38Γ", "Πάνορμου", "Αλέξη Παυλή 38Γ, Πάνορμου, Αθήνα", "37.9935", "23.7640"),
    ("Piraeus", "", "Βούλγαρη 134", "Πειραιάς", "Βούλγαρη 134, Πειραιάς", "37.9520", "23.6480"),
    ("Kifisia", "Athens · North", "Λεωφόρος Κηφισίας 238–240", "Κηφισιά", "Λεωφόρος Κηφισίας 238–240, Κηφισιά", "38.0280", "23.7900"),
    ("Neos Kosmos", "Athens · South", "Γουβέλη 12", "Νέος Κόσμος", "Γουβέλη 12, Νέος Κόσμος, Αθήνα", "37.9575", "23.7290"),
    ("Glyfada", "Athens · South", "Μαραγκού 8", "Γλυφάδα", "Μαραγκού 8, Γλυφάδα", "37.8650", "23.7530"),
]

FAQ = [
    ("Do you offer vegan or gluten-free options?",
     "Yes. We offer selected vegan and gluten-free cookie options to accommodate different dietary preferences. Availability may vary depending on the season and product range. If you have specific dietary requirements or allergies, please contact us before placing your order and our team will be happy to assist."),
    ("How long do cookies stay fresh?",
     "Our cookies are baked fresh daily for the best taste and texture. We recommend enjoying them within 3–5 days of purchase when stored in an airtight container at room temperature. For longer storage, cookies can be frozen and enjoyed later."),
    ("Can I order cookies for events or corporate gifts?",
     "Absolutely. KUKI Athens offers custom cookie orders for corporate events, business gifts, celebrations, weddings, birthdays, and special occasions. We can accommodate larger quantities and discuss customized packaging or branding options depending on your requirements."),
]

CAREERS = [
    ("Ilion", "Athens · West", True, "Κεντρικό παρασκευαστήριο · Ψάχνουμε για θέση ζαχαροπλάστη", "Bring warmth, pace, and a little magic to every Kuki visit."),
    ("Kypseli", "Athens · Central", True, "Βοηθός ζαχαροπλάστη · Ταμίας · Barista", "Help us make the neighbourhood’s favourite cookie stop feel like home."),
    ("Panormou", "Athens · North", True, "Βοηθός ζαχαροπλάστη · Ταμίας · Barista", "A people-first role for someone who loves a busy counter and a good story."),
    ("Piraeus", "", True, "Βοηθός ζαχαροπλάστη · Ταμίας · Barista", "Make every hand-off feel personal, generous, and unmistakably Kuki."),
    ("Kifisia", "Athens · North", False, "Βοηθός ζαχαροπλάστη · Ταμίας · Barista", "No open roles today, but we would love to hear from great people."),
    ("Neos Kosmos", "Athens · South", True, "Βοηθός ζαχαροπλάστη · Ταμίας · Barista", "Tell us what you do best and we will keep your CV close."),
    ("Thessaloniki", "", True, "Βοηθός ζαχαροπλάστη · Ταμίας · Barista", "Join the next chapter as Kuki brings the good stuff north."),
    ("Glyfada", "Athens · South", True, "Βοηθός ζαχαροπλάστη · Ταμίας · Barista", "A bright, welcoming role with plenty of room to grow."),
    ("Manchester", "", True, "Βοηθός ζαχαροπλάστη · Ταμίας · Barista", "Help us make soft, buttery, ridiculously good cookies across the water."),
]

GALLERY = [
    ("g-flatlay", "Flat lay of assorted KUKI cookies and brookies beside a branded box"),
    ("g-cup-hand", "A KUKI dessert cup with a spoon, held up inside the store"),
    ("g-box-pistachio", "A cookie topped with pistachio cream on a sage green KUKI box"),
    ("g-selection", "Close-up of a selection of KUKI cookies, one topped with pink cream"),
    ("g-cups-store", "Layered Kuki's & Cream dessert cups in the store"),
    ("g-swirl-box", "A cookie with a chocolate cream swirl on a KUKI box"),
    ("g-mix", "Assorted KUKI cookies and brownies arranged on a table"),
    ("g-cup-caramel", "A caramel Kuki's & Cream cup held in hand"),
    ("g-box-flatlay", "Top-down view of KUKI cookies and boxes"),
    ("g-coffee-flatlay", "KUKI coffee cups and cookies on a table"),
    ("g-cups-counter", "A row of dessert cups on the counter against the checkerboard wall"),
    ("g-cup-held", "A Kuki's & Cream cup with biscuit crumble held in hand"),
    ("g-box-hazelnut", "A hazelnut cookie on a KUKI box"),
    ("g-brownie-box", "A brownie on a KUKI box"),
    ("g-brookie-box", "A brookie on a KUKI box"),
    ("g-brookie-lotus", "A brookie topped with caramel biscuit crumble"),
    ("g-brookie-pistachio", "A brookie topped with pistachio"),
    ("g-brookie-crumble", "A brookie with crumble topping on a KUKI box"),
    ("g-cookie-box", "A chocolate chip cookie on a KUKI box"),
    ("g-dark-cookie-box", "A dark chocolate cookie on a KUKI box"),
    ("g-lotus-box", "A caramel biscuit cookie on a KUKI box"),
    ("g-pink-box", "A cookie topped with pink cream on a KUKI box"),
    ("g-assortment", "Assorted KUKI cookies and brookies with their boxes"),
    ("g-counter", "Cookies on display at a KUKI store counter"),
]

NAV = [("Home", "/"), ("Menu", "/pages/menu"), ("About", "/#about"), ("Gallery", "/pages/gallery"),
       ("Locations", "/#locations"), ("Contact", "/pages/contact"), ("Careers", "/pages/careers")]


def blocks(items, btype, fn):
    out, order = {}, []
    for i, it in enumerate(items, 1):
        bid = f"{btype}_{i}"
        out[bid] = {"type": btype, "settings": fn(it)}
        order.append(bid)
    return out, order


def section(stype, settings=None, items=None, btype=None, fn=None):
    s = {"type": stype, "settings": settings or {}}
    if items is not None:
        s["blocks"], s["block_order"] = blocks(items, btype, fn)
    return s


def menu_item(m):
    name, cat, price, desc, asset = m
    return {"name": name, "category": cat, "price": price, "description": desc, "asset": asset}


def gallery_item(g):
    return {"asset": g[0], "alt": g[1]}


def template(sections):
    return {"sections": {k: v for k, v in sections}, "order": [k for k, _ in sections]}


def write(name, data):
    p = ROOT / "templates" / name
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


HOME = template([
    ("hero", section("hero", {"cta_secondary_url": "#lineup"}, [
        ("sun", "Baked fresh daily"), ("whisk", "Handmade pralines & caramel"), ("wheat", "French butter")
    ], "badge", lambda b: {"icon": b[0], "text": b[1]})),
    ("marquee", section("marquee", {"speed": 40}, ["Baked fresh daily", "Handmade pralines", "French butter", "Premium chocolate", "Roasted in-house", "Made in Athens"], "item", lambda t: {"text": t})),
    ("story", section("story", {
        "title": "Baked with *Love,* Served with *Joy*",
        "text": "At KUKI, every cookie is handcrafted to turn a simple break into something worth craving. Made with rich butter, premium chocolate, handmade fillings, and a touch of fleur de sel, each bite is soft, bold, and full of comfort.",
    }, [
        ("Premium Ingredients", "Selected butter, quality chocolate, and carefully sourced ingredients in every recipe."),
        ("Expert Craft", "Handcrafted cookies made with precision, technique, and attention to every detail."),
        ("Quality First", "Every recipe is designed to deliver consistency, balance, and a premium taste experience."),
        ("Baked Daily", "Prepared daily to ensure maximum freshness, softness, and flavor in every bite."),
    ], "pillar", lambda p: {"title": p[0], "text": p[1]})),
    ("lineup", section("lineup", {"link_url": "/pages/menu"}, [m for m in MENU if m[1] == "cookies"], "product", menu_item)),
    ("about", section("about", {
        "quote": "We don't do *average.*",
        "text": "Every cookie at Kuki is made entirely in-house — from roasting the nuts to crafting the pralines and caramel from scratch. No shortcuts. No compromises. Just cookies that make you stop mid-bite and go “wait, what.”",
    }, [
        ("whisk", "Made in-house", "From roasting the nuts to the last crumb."),
        ("badge", "Handmade pralines & caramel", "Crafted from scratch."),
        ("wheat", "French butter & premium chocolate", "Carefully selected ingredients."),
        ("sun", "Baked daily in our stores", "Enjoyed fresh, soft and full of flavour."),
    ], "fact", lambda f: {"icon": f[0], "title": f[1], "text": f[2]})),
    ("process", section("process", {}, [
        ("Ingredient Selection", "Premium Sourcing", "We carefully select high-quality ingredients from trusted suppliers to ensure every cookie starts with the best foundation.", "i-mascot-cookie", "KUKI mascot holding up a cookie"),
        ("Craft & Preparation", "Consistent Process", "Every batch follows a precise method, balancing flavor and texture to deliver the same perfect result every time.", "i-mascot-drink", "KUKI mascot enjoying a drink"),
        ("Final Quality Check", "Freshness Guaranteed", "Before reaching you, each cookie is checked to meet our standards, ensuring freshness, taste, and satisfaction in every bite.", "i-mascot-thumbs", "KUKI mascot giving a thumbs up"),
    ], "step", lambda s: {"kicker": s[0], "title": s[1], "text": s[2], "asset": s[3], "image_alt": s[4]})),
    ("reviews", section("testimonials", {}, [
        ("Excellent experience. The service was polite, pleasant and very friendly, with a desire to serve the customer properly. The quality of the cookies is truly incredible. I took one cookie from each flavor and they were all the same: delicious, crispy and fresh. Honestly, it is difficult to distinguish which was my favorite.", "George A.", "Google Reviews"),
    ], "review", lambda r: {"quote": r[0], "author": r[1], "source": r[2]})),
    ("locations", section("locations", {"text": "Seven stores across Athens and Piraeus, each one baking fresh every day. Pick a store for directions — or let us find the closest one to you."}, STORES, "store",
        lambda s: {"name": s[0], "area": s[1], "street": s[2], "locality": s[3], "query": s[4], "lat": s[5], "lng": s[6]})),
    ("gallery", section("gallery", {"title": "Join the *community*", "text": "Fresh out of the oven, straight onto your feed. See what we're baking at @kuki.ath.", "link_url": "/pages/gallery", "background": "cream"}, GALLERY[:8], "image", gallery_item)),
    ("franchise", section("cta-band", {"url": "/pages/contact"})),
    ("faq", section("faq", {"contact_text": "Dietary needs, allergies, events or corporate gifts — message us and our team will be happy to help."}, FAQ, "question", lambda q: {"question": q[0], "answer": q[1]})),
    ("newsletter", section("newsletter")),
])

MENU_T = template([
    ("hero", section("page-hero", {"eyebrow": "Fresh from the oven · @kuki.ath", "title": "Our *Menu*", "text": "A small but dangerous menu of soft cookies, Kuki's & Cream cups, Kuki Rolls and coffee.", "show_order": True, "asset": "i-mascot-wave"})),
    ("menu", section("menu", {"note": MENU_NOTE, "note_lang": "el"}, MENU, "product", menu_item)),
    ("locations", HOME["sections"]["locations"]),
])

GALLERY_T = template([
    ("hero", section("page-hero", {"eyebrow": "Join the community", "title": "The *Gallery*", "text": "Cookies, brookies, cups and the people who love them. Tap any photo to view it full-screen.", "asset": "i-mascot-face"})),
    ("gallery", section("gallery", {"full": True, "anchor": "photos"}, GALLERY, "image", gallery_item)),
    ("newsletter", section("newsletter")),
])

CONTACT_T = template([
    ("hero", section("page-hero", {"eyebrow": "Contact", "title": "Let's *talk.*", "text": "Franchise and business enquiries, events and corporate gifts — we read every message.", "asset": "i-mascot-milk"})),
    ("form", section("contact-form", {"text": "Interested in opening the next Kuki? Tell us a little about yourself, your city and your plans, and our team will get back to you."})),
    ("faq", section("faq", {"contact_text": "Prefer a quick chat? Message us on Instagram."}, FAQ, "question", lambda q: {"question": q[0], "answer": q[1]})),
])

CAREERS_T = template([
    ("hero", section("page-hero", {"eyebrow": "We're hiring", "title": "Make good things *with us.*", "text": "Kuki is growing, and we’re looking for warm, curious people to help us make every visit feel a little more special.", "asset": "i-mascot-thumbs"})),
    ("careers", section("careers", {
        "stores_text": "Every store has its own rhythm. Choose the one that feels like you.",
        "form_text": "Choose a store, share a little about yourself, and our team will be in touch when there’s a match. Even if your store is not hiring today, send your details and we’ll keep you in mind.",
    }, CAREERS, "store", lambda c: {"store": c[0], "area": c[1], "hiring": c[2], "jobs": c[3], "text": c[4]})),
])

write("index.json", HOME)
write("page.menu.json", MENU_T)
write("page.gallery.json", GALLERY_T)
write("page.contact.json", CONTACT_T)
write("page.careers.json", CAREERS_T)
write("page.json", template([("main", section("main-page"))]))
write("404.json", template([("main", section("main-404"))]))
for t in ["product", "collection", "list-collections", "cart", "search", "blog", "article"]:
    write(f"{t}.json", template([("main", section("main-generic"))]))

settings_path = ROOT / "config" / "settings_data.json"
data = json.loads(settings_path.read_text(encoding="utf-8"))
cur = data["presets"]["Default"]
nav_blocks, nav_order = blocks(NAV, "link", lambda n: {"label": n[0], "url": n[1]})
cur["sections"] = {
    "header": {"type": "header", "settings": {"order_label": "Order now"}, "blocks": nav_blocks, "block_order": nav_order},
    "footer": {"type": "footer", "settings": {}},
}
data["current"] = cur
data.pop("presets")
data["presets"] = {"Default": dict(cur)}
settings_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("templates written")
