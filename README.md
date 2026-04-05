# M031 Kod Üretici

Bu proje, AI kullanmadan hazır template'leri birleştirerek Nuvoton M031FB için başlangıç kodu üretir.

## Mevcut özellikler
- MCU seçimi (şimdilik M031FB)
- Clock seçimi
- UART0 ayarı + pin kombinasyonu
- TIMER0 ayarı
- ADC ayarı
- Pin çakışması kontrolü
- main.c üretimi
- config export/import

## Yerelde çalıştırma
Statik dosya olduğu için doğrudan açılabilir; ancak fetch kullandığı için yerel testte küçük bir HTTP sunucusu daha sağlıklıdır.

Örnek Python ile:

```bash
python -m http.server 8000
```

Sonra tarayıcıda:

```text
http://localhost:8000
```

## Not
Üretilen bazı pin macro satırlarında yorum olarak `Replace with exact BSP macro if needed` eklendi.
Bunun sebebi farklı BSP sürümlerinde helper macro isimlerinin değişebilmesidir.
Ham MFP macro isimleri de yorum satırında bırakıldı.
