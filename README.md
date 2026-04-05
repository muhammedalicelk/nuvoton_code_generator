# M031 Kod Üretici

Statik HTML/CSS/JS tabanlı, template kullanan M031 kod üretici aracı.

## Bu sürümde
- UART0 pin kombinasyonları gerçek RX/TX seti olarak seçilir.
- ADC çoklu kanal seçimi desteklenir.
- ADC kodu UART kullanmadan global değişkenlere veri yazar.
- ADC için `ADC0_Init`, `ADC0_Read` ve `ADC_IRQHandler` üretilir.
- ADC pinleri için MFP, `GPIO_SetMode` ve `GPIO_DISABLE_DIGITAL_PATH` satırları otomatik oluşur.

## Yayın
GitHub Pages ile doğrudan yayınlanabilir.


## v5 pin database
- UART0 pin setleri `sys.h` içindeki mevcut MFP makrolarına göre genişletildi.
- ADC kanalları `ADC0_CH0..ADC0_CH15 -> PB.0..PB.15` olacak şekilde düzeltildi.
